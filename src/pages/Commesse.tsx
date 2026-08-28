import { useState, useMemo, useEffect, useRef } from 'react';
import { useAuth, isTechnicalUser, type PunchListItem, TODO_CATEGORIE } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, doc, setDoc, updateDoc, addDoc, deleteDoc, getDocs, runTransaction } from 'firebase/firestore';
import { Briefcase, ChevronLeft, ChevronRight, ChevronDown, Calendar, Download, Pencil, X, ZoomIn, ZoomOut, Trash2, RefreshCw, Printer, Plus, UserCheck, MoveVertical, Building2, Send, Info, Mail, User, Folder, FolderOpen, ListTodo, Check, CheckCircle2, Clock, AlertTriangle, ExternalLink } from 'lucide-react';
import { getWeekNumber, getStartOfWeek, addDays } from '../utils/date';
import { queueMail } from '../utils/mailSender';
import { TIPOLOGIA_COLORS } from '../utils/commesseIniziali';
import ConfirmModal from '../components/ConfirmModal';
import { PianificazioneModal } from '../components/PianificazioneModal';
import { ResourceAvailabilityModal } from '../components/ResourceAvailabilityModal';
import { getPrintDateString, APP_VERSION } from '../config/version';
import { TIPOLOGIE_COMMESSE, isSoci } from './Impostazioni';
import { getCommesseNotificationEmails } from '../utils/emailTemplateManager';



const hexToRgba = (hex: string, alpha: number): string => {
  if (!hex) return `rgba(100, 116, 139, ${alpha})`;
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map(char => char + char).join('');
  }
  const num = parseInt(cleanHex, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const getLeaveHoursForDay = (
  l: {
    tipo?: string;
    frazioneTipo?: string;
    oraInizio?: string;
    oraFine?: string;
    pausaPranzo?: boolean;
    pausaPranzoOre?: number;
  },
  dailyContractHours: number = 8
): number => {
  if (!l || l.tipo === 'smart') return 0;

  if (
    l.frazioneTipo === 'giornata' ||
    l.tipo === 'ferie' ||
    l.tipo === 'malattia' ||
    l.tipo === 'maternita'
  ) {
    return dailyContractHours;
  }

  if (
    l.frazioneTipo === 'mattina' ||
    l.frazioneTipo === 'pomeriggio' ||
    l.tipo === 'mattina' ||
    l.tipo === 'pomeriggio'
  ) {
    return dailyContractHours / 2;
  }

  if (
    (l.frazioneTipo === 'orario' || l.tipo === 'permesso' || l.tipo === 'ex_l104' || l.tipo === 'studio' || (!l.frazioneTipo && l.oraInizio && l.oraFine)) &&
    l.oraInizio &&
    l.oraFine
  ) {
    const [hStart, mStart] = l.oraInizio.split(':').map(Number);
    const [hEnd, mEnd] = l.oraFine.split(':').map(Number);
    if (!isNaN(hStart) && !isNaN(hEnd)) {
      const diffMs = new Date(2000, 0, 1, hEnd, mEnd || 0).getTime() - new Date(2000, 0, 1, hStart, mStart || 0).getTime();
      let hrs = Math.max(0, Math.round((diffMs / 3600000) * 100) / 100);
      if (l.pausaPranzo && l.pausaPranzoOre) {
        hrs = Math.max(0, hrs - l.pausaPranzoOre);
      }
      return Math.min(dailyContractHours, hrs);
    }
  }

  if (l.tipo === 'permesso' || l.tipo === 'ex_l104' || l.tipo === 'studio') {
    return dailyContractHours / 2;
  }

  return dailyContractHours;
};




interface WeekInfo {
  id: string;
  label: string;
  sub: string;
  dateObj?: Date;
}

// // Client dictionary for code translation
// const CLIENTI_DICTIONARY: Record<string, string> = {
//   '61': 'GSK',
//   '12': 'Novartis',
//   '33': 'Eli Lilly',
//   '45': 'Pfizer',
//   '01': 'Ingegnoso',
//   '99': 'Cliente di Test'
// };

// const getClientName = (code: string): string => {
//   return CLIENTI_DICTIONARY[code] || `Cliente ${code}`;
// };

// const parseClientCode = (commessaName: string): string => {
//   const match = commessaName.match(/^P-\d+-(\d+)/i);
//   if (match) {
//     return match[1];
//   }
//   return '';
// };

const formatDate = (dateStr?: any): string => {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
};

const areNamesEqual = (n1?: string | null, n2?: string | null): boolean => {
  if (!n1 || !n2 || typeof n1 !== 'string' || typeof n2 !== 'string') return false;
  const clean1 = n1.toLowerCase().trim().replace(/\s+/g, ' ');
  const clean2 = n2.toLowerCase().trim().replace(/\s+/g, ' ');
  if (clean1 === clean2) return true;
  const w1 = clean1.split(' ').sort().join(' ');
  const w2 = clean2.split(' ').sort().join(' ');
  return w1 === w2;
};

const getInitials = (name?: string | null): string => {
  if (!name || typeof name !== 'string') return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return ((parts[0][0] || '') + (parts[parts.length - 1][0] || '')).toUpperCase();
};

interface CommessaProgetto {
  descrizione: string;
  pm: string;
  utentiDaAbilitare?: string[];
  sgq: 'SI' | 'NO';
  verificatori: string[];
  compilatore: string;
  giornateSenior: number;
  giornateProject: number;
  giornateJunior: number;
}

const getNextAvailableLetter = (
  tipologia: string,
  anno: string,
  clientCodice: string,
  existingCommesse: any[]
): string => {
  const paddedClientCode = clientCodice.padStart(4, '0');
  const prefix = `${tipologia}${anno.slice(-2)}${paddedClientCode}`;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  
  for (let i = 0; i < alphabet.length; i++) {
    const letter = alphabet[i];
    const candidateCode = `${prefix}${letter}`;
    if (!existingCommesse.some(c => c.codiceCommessa === candidateCode)) {
      return letter;
    }
  }
  
  for (let i = 0; i < alphabet.length; i++) {
    for (let j = 0; j < alphabet.length; j++) {
      const letter = alphabet[i] + alphabet[j];
      const candidateCode = `${prefix}${letter}`;
      if (!existingCommesse.some(c => c.codiceCommessa === candidateCode)) {
        return letter;
      }
    }
  }
  return 'A';
};

// Custom extended week generator
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

// Calcola tutte le settimane comprese tra due date YYYY-MM-DD
const getWeeksSpannedByDates = (startDateStr: string, endDateStr: string): string[] => {
  if (!startDateStr || !endDateStr) return [];
  const list: string[] = [];
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  
  let curr = getStartOfWeek(start);
  while (curr <= end) {
    const wkNum = getWeekNumber(curr);
    const y = curr.getFullYear();
    const wkId = `${y}-W${wkNum}`;
    if (!list.includes(wkId)) {
      list.push(wkId);
    }
    curr = addDays(curr, 7);
  }
  return list;
};

export default function Commesse() {
  const { 
    isAdmin = false, 
    isDev = false,
    isGestoreCommesse = false,
    myAssociatedName = '', 
    userEmail = '',
    dipendenti = [], 
    commesse = [], 
    clienti: clientiList = [], 
    assegnazioni: assignments = {}, 
    approvedLeaves = [], 
    coordinatori = [], 
    pmsEmails = [],
    responsabiliCommesseEmails = [],
    prioritaCommesse = {},
    loadPlanningData,
    loadAllCommesse,
    refreshData,
    refreshDataIfStale
  } = useAuth();

  const myDip = useMemo(() => dipendenti.find(d => areNamesEqual(d.nome, myAssociatedName) || (d.email && userEmail && d.email.toLowerCase() === userEmail.toLowerCase())), [dipendenti, myAssociatedName, userEmail]);

  const [tableHeight, setTableHeight] = useState<number>(650);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const heightTextRef = useRef<HTMLSpanElement>(null);
  const animationFrameRef = useRef<number | null>(null);

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

  const myCoordinatedAreas = useMemo((): string[] => {
    if (!userEmail) return [];
    return coordinatori
      .filter(c => c.email && c.email.toLowerCase() === userEmail.toLowerCase())
      .map(c => c.area);
  }, [userEmail, coordinatori]);

  const getOfficialName = (inputName?: string | null) => {
    if (!inputName) return '';
    const found = dipendenti.find(d => areNamesEqual(d.nome, inputName));
    return found ? found.nome : inputName;
  };

  const formatPMField = (pmField: any) => {
    if (!pmField) return '';
    const arr = Array.isArray(pmField) ? pmField : [pmField];
    return arr.map(name => getOfficialName(name)).filter(Boolean).join(', ');
  };
  
  const [baseDate, setBaseDate] = useState<Date>(new Date());
  const [zoomWeeks, setZoomWeeks] = useState<number>(6); // Default to 6 Weeks
  const [selectedCommessaIdsFilter, setSelectedCommessaIdsFilter] = useState<string[]>([]);
  const [selectedClientFilter, setSelectedClientFilter] = useState<string>('');
  const [selectedPMFilter, setSelectedPMFilter] = useState<string>('');
  const [selectedTipologiaFilter, setSelectedTipologiaFilter] = useState<string>('');
  const [commessaTextQuery, setCommessaTextQuery] = useState('');

  // Tab control
  const [activeTab, setActiveTab] = useState<'consultazione' | 'gestione' | 'altre-commesse'>('consultazione');

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

  // Commesse form states
  const [newCommessaTipologia, setNewCommessaTipologia] = useState('A');
  const [newCommessaAnno, setNewCommessaAnno] = useState(new Date().getFullYear().toString());
  const [newCommessaLettera, setNewCommessaLettera] = useState('A');
  const [newCommessaTitolo, setNewCommessaTitolo] = useState('');
  const [newCommessaDataInizio, setNewCommessaDataInizio] = useState('');
  const [newCommessaDataFine, setNewCommessaDataFine] = useState('');
  const [newCommessaResponsabile, setNewCommessaResponsabile] = useState('');

  // Stati per la creazione Nuova Commessa e Progetti
  const [newCommessaProgettiDescrizioni, setNewCommessaProgettiDescrizioni] = useState<string[]>([
    'FORMAZIONE - Attività formative sulla commessa'
  ]);
  const [newCommessaPM, setNewCommessaPM] = useState('');
  const [newCommessaUtentiDaAbilitare, setNewCommessaUtentiDaAbilitare] = useState<string[]>([]);
  const [newCommessaSGQ, setNewCommessaSGQ] = useState<'SI' | 'NO'>('NO');
  const [newCommessaVerificatori, setNewCommessaVerificatori] = useState<string[]>([]);
  const [newCommessaCompilatore, setNewCommessaCompilatore] = useState('');
  const [newCommessaGiornateSenior, setNewCommessaGiornateSenior] = useState(0);
  const [newCommessaGiornateProject, setNewCommessaGiornateProject] = useState(0);
  const [newCommessaGiornateJunior, setNewCommessaGiornateJunior] = useState(0);

  // (editProgetti stato rimosso — gestito localmente nelle modali)

  // Searchable Client Dropdown States (Form Nuova Commessa)
  const [selectedClient, setSelectedClient] = useState<{ codice: string; nome: string } | null>(null);
  const [clientSearchText, setClientSearchText] = useState('');
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);

  // Stati Modale Modifica Catalogo Commessa Completa & Info Modal Sola Lettura
  const [editingCommessa, setEditingCommessa] = useState<any | null>(null);
  const [infoModalCommessa, setInfoModalCommessa] = useState<any | null>(null);

  const [editTitolo, setEditTitolo] = useState('');
  const [editCliente, setEditCliente] = useState('');
  const [editAnno, setEditAnno] = useState('');
  const [editTipologia, setEditTipologia] = useState('');
  const [editStato, setEditStato] = useState<'Aperta' | 'Chiusa'>('Aperta');
  const [editDataInizio, setEditDataInizio] = useState('');
  const [editDataFine, setEditDataFine] = useState('');
  const [editResponsabile, setEditResponsabile] = useState('');
  const [editProgettiDescrizioni, setEditProgettiDescrizioni] = useState<string[]>([]);
  const [editPM, setEditPM] = useState('');
  const [editUtentiDaAbilitare, setEditUtentiDaAbilitare] = useState<string[]>([]);
  const [editSGQ, setEditSGQ] = useState<'SI' | 'NO'>('NO');
  const [editVerificatori, setEditVerificatori] = useState<string[]>([]);
  const [editCompilatore, setEditCompilatore] = useState('');
  const [editGiornateSenior, setEditGiornateSenior] = useState<number>(0);
  const [editGiornateProject, setEditGiornateProject] = useState<number>(0);
  const [editGiornateJunior, setEditGiornateJunior] = useState<number>(0);
  // Searchable Filter Dropdowns per Catalogo Commesse
  const [isCatClienteOpen, setIsCatClienteOpen] = useState(false);
  const [catClienteSearch, setCatClienteSearch] = useState('');

  const [isCatRespOpen, setIsCatRespOpen] = useState(false);
  const [catRespSearch, setCatRespSearch] = useState('');

  const [isCatPMOpen, setIsCatPMOpen] = useState(false);
  const [catPMSearch, setCatPMSearch] = useState('');

  const [isCatAnnoOpen, setIsCatAnnoOpen] = useState(false);
  const [catAnnoSearch, setCatAnnoSearch] = useState('');

  const [isCatTipologiaOpen, setIsCatTipologiaOpen] = useState(false);
  const [catTipologiaSearch, setCatTipologiaSearch] = useState('');

  // Searchable Altre Commesse Dropdown States (per Coordinatori)
  const [altreCommessaSearchText, setAltreCommessaSearchText] = useState('');
  const [selectedAltreCommessa, setSelectedAltreCommessa] = useState<any | null>(null);
  const [isAltreCommessaDropdownOpen, setIsAltreCommessaDropdownOpen] = useState(false);

  // Modal rapida per Aggiungi Cliente
  const [isNewClientModalOpen, setIsNewClientModalOpen] = useState(false);
  const [newClientNome, setNewClientNome] = useState('');
  const [isSavingNewClient, setIsSavingNewClient] = useState(false);

  const nextProgressiveClientCode = useMemo(() => {
    if (!clientiList || clientiList.length === 0) return '1';
    const highest = Math.max(...clientiList.map(c => parseInt(c.codice) || 0), 0);
    return (highest + 1).toString();
  }, [clientiList]);

  const handleSaveNewClientQuickly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientNome.trim()) {
      showToast("Inserisci la ragione sociale del nuovo cliente.", "warning");
      return;
    }

    setIsSavingNewClient(true);
    try {
      let createdDoc: { id: string; codice: string; nome: string } | null = null;
      await runTransaction(db, async (transaction) => {
        const clientiSnap = await getDocs(collection(db, 'clienti'));
        let highest = 0;
        clientiSnap.forEach(d => {
          const val = parseInt(d.data().codice) || 0;
          if (val > highest) highest = val;
        });
        const nextCode = (highest + 1).toString();
        const newRef = doc(collection(db, 'clienti'));
        const payload = {
          codice: nextCode,
          nome: newClientNome.trim()
        };
        transaction.set(newRef, payload);
        createdDoc = { id: newRef.id, ...payload };
      });

      if (createdDoc) {
        setSelectedClient(createdDoc);
        setClientSearchText((createdDoc as any).nome);
        setIsClientDropdownOpen(false);
        showToast(`Cliente ${(createdDoc as any).codice} - ${(createdDoc as any).nome} aggiunto ed impostato!`, "success");
      }
      setNewClientNome('');
      setIsNewClientModalOpen(false);
    } catch (err) {
      console.error("Errore salvataggio rapido cliente:", err);
      showToast("Si è verificato un errore durante il salvataggio del cliente.", "error");
    } finally {
      setIsSavingNewClient(false);
    }
  };

  // Search and Advanced Filters for Catalogo Commesse
  const [searchCommessaQuery, setSearchCommessaQuery] = useState('');
  const [catalogoStatoFilter, setCatalogoStatoFilter] = useState<'Aperta' | 'Tutte' | 'Chiusa'>('Aperta'); // Default solo Aperte!
  const [catalogoRespFilter, setCatalogoRespFilter] = useState<string>('');
  const [catalogoPMFilter, setCatalogoPMFilter] = useState<string>('');
  const [catalogoClienteFilter, setCatalogoClienteFilter] = useState<string>('');
  const [catalogoAnnoFilter, setCatalogoAnnoFilter] = useState<string>('');
  const [catalogoTipologiaFilter, setCatalogoTipologiaFilter] = useState<string>('');
  const [catalogoSortBy, setCatalogoSortBy] = useState<'codice' | 'anno' | 'tipologia' | 'titolo' | 'cliente' | 'stato' | 'responsabile' | 'pm' | 'dataApertura'>('codice');
  const [catalogoSortDir, setCatalogoSortDir] = useState<'asc' | 'desc'>('asc');
  const [showNewCommessaForm, _setShowNewCommessaForm] = useState(true);

  // Gestione parametri URL da notifiche (es. ?search=CO123 o ?commessaId=xyz)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const searchParam = params.get('search');
    const commessaIdParam = params.get('commessaId');
    if (searchParam) {
      setCommessaTextQuery(decodeURIComponent(searchParam));
    } else if (commessaIdParam) {
      const matched = commesse.find(c => c.id === commessaIdParam);
      if (matched) {
        setCommessaTextQuery(matched.nome || matched.codiceCommessa || '');
      }
    }
  }, [commesse]);
  
  const weekColumnMinWidth = useMemo(() => {
    if (zoomWeeks <= 6) return '100px';
    if (zoomWeeks <= 12) return '75px';
    if (zoomWeeks <= 20) return '60px';
    return '50px';
  }, [zoomWeeks]);

  const commesseDateRangeMap = useMemo(() => {
    const map = new Map<string, { startMs: number; endMs: number } | null>();
    commesse.forEach(c => {
      if (c.dataInizio && c.dataFine) {
        const s = new Date(c.dataInizio);
        const e = new Date(c.dataFine);
        s.setHours(0, 0, 0, 0);
        e.setHours(23, 59, 59, 999);
        map.set(c.id, { startMs: s.getTime(), endMs: e.getTime() });
      } else {
        map.set(c.id, null);
      }
    });
    return map;
  }, [commesse]);

  const isNarrow = useMemo(() => parseInt(weekColumnMinWidth) < 80, [weekColumnMinWidth]);
  const isUltraNarrow = useMemo(() => parseInt(weekColumnMinWidth) < 62, [weekColumnMinWidth]);
  const [isAvailabilityModalOpen, setIsAvailabilityModalOpen] = useState(false);

  useEffect(() => {
    loadPlanningData?.();
    refreshDataIfStale();
  }, [loadPlanningData]);



  const selectableClientiPerFiltro = useMemo(() => {
    const set = new Set<string>();
    commesse.forEach(c => {
      if ((c.stato || 'Aperta') !== 'Chiusa' && c.cliente) set.add(c.cliente.trim());
    });
    return Array.from(set).sort();
  }, [commesse]);

  const selectablePMPerFiltro = useMemo(() => {
    const names: string[] = [];
    commesse.forEach(c => {
      if ((c.stato || 'Aperta') !== 'Chiusa' && c.responsabile && c.responsabile.trim()) {
        const raw = c.responsabile.trim();
        const matchedDip = dipendenti.find(d => areNamesEqual(d.nome, raw));
        const canonicalName = matchedDip ? matchedDip.nome : raw;
        if (!names.some(n => areNamesEqual(n, canonicalName))) {
          names.push(canonicalName);
        }
      }
    });
    return names.sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
  }, [commesse, dipendenti]);

  const toggleCommessaIdFilter = (commId: string) => {
    setSelectedCommessaIdsFilter(prev => {
      const next = prev.includes(commId) ? prev.filter(id => id !== commId) : [...prev, commId];
      if (next.length === 1) {
        const comm = commesse.find(c => c.id === next[0]);
        if (comm && comm.dataInizio && comm.dataFine) {
          const start = new Date(comm.dataInizio);
          const end = new Date(comm.dataFine);
          const diffTime = Math.abs(end.getTime() - start.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          const numWks = Math.max(2, Math.min(52, Math.ceil(diffDays / 7)));
          setBaseDate(getStartOfWeek(start));
          setZoomWeeks(numWks);
        }
      }
      return next;
    });
  };


  
  const [isCommessaDropdownOpen, setIsCommessaDropdownOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  // Gestione Percorso Cartella di Rete Commessa
  const [isNetworkPathModalOpen, setIsNetworkPathModalOpen] = useState(false);
  const [selectedCommessaForNetworkPath, setSelectedCommessaForNetworkPath] = useState<any | null>(null);
  const [networkPathInput, setNetworkPathInput] = useState('');
  const [isSavingNetworkPath, setIsSavingNetworkPath] = useState(false);

  const handleOpenNetworkPath = (comm: any, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    const rawPath = comm.percorsoRete?.trim();
    if (!rawPath) {
      setSelectedCommessaForNetworkPath(comm);
      setNetworkPathInput('');
      setIsNetworkPathModalOpen(true);
      return;
    }

    // 1. Copia negli appunti (sempre garantito)
    try {
      navigator.clipboard.writeText(rawPath);
      showToast("📁 Percorso copiato negli appunti! Premi Win + R o incollalo nella barra di Esplora Risorse.", "success");
    } catch (err) {
      console.error("Errore copia appunti:", err);
      showToast(`📁 Percorso: ${rawPath}`, "warning");
    }

    // 2. Tenta l'apertura tramite il protocollo Windows registrato
    try {
      const protocolUri = `ingegno-path:${encodeURIComponent(rawPath)}`;
      const tempLink = document.createElement('a');
      tempLink.href = protocolUri;
      tempLink.style.display = 'none';
      document.body.appendChild(tempLink);
      tempLink.click();
      setTimeout(() => {
        if (document.body.contains(tempLink)) {
          document.body.removeChild(tempLink);
        }
      }, 1500);
    } catch (err) {
      console.error("Errore protocollo ingegno-path:", err);
    }
  };

  const handleSaveNetworkPath = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCommessaForNetworkPath) return;
    setIsSavingNetworkPath(true);
    let cleanPath = networkPathInput.trim();
    // Rimuove eventuali virgolette esterne incollate per errore
    if ((cleanPath.startsWith('"') && cleanPath.endsWith('"')) || (cleanPath.startsWith("'") && cleanPath.endsWith("'"))) {
      cleanPath = cleanPath.slice(1, -1).trim();
    }
    const commId = selectedCommessaForNetworkPath.id;
    try {
      await updateDoc(doc(db, 'catalogo_commesse', commId), {
        percorsoRete: cleanPath
      });
      // Aggiornamento immediato in memoria per feedback istantaneo
      selectedCommessaForNetworkPath.percorsoRete = cleanPath;
      const targetInList = commesse.find(c => c.id === commId);
      if (targetInList) {
        targetInList.percorsoRete = cleanPath;
      }
      if (infoModalCommessa && infoModalCommessa.id === commId) {
        setInfoModalCommessa({ ...infoModalCommessa, percorsoRete: cleanPath });
      }

      showToast(cleanPath ? "📁 Percorso di rete salvato con successo!" : "Percorso di rete rimosso.", "success");
      setIsNetworkPathModalOpen(false);
      setSelectedCommessaForNetworkPath(null);
      setNetworkPathInput('');
      if (loadPlanningData) {
        await loadPlanningData();
      }
      if (refreshData) {
        await refreshData();
      }
    } catch (err: any) {
      console.error("Errore salvataggio percorso rete:", err);
      showToast("Errore nel salvataggio del percorso: " + err.message, "error");
    } finally {
      setIsSavingNetworkPath(false);
    }
  };

  // Configurazione Categorie ToDo List (18 categorie ordinate alfabeticamente con icone e stili dedicati)
  const CATEGORIA_CONFIG: Record<string, { label: string; icon: string; bg: string; text: string; border: string }> = {
    'aggiornare': { label: 'Aggiornare', icon: '🔄', bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-300' },
    'archiviare': { label: 'Archiviare', icon: '🗄️', bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-300' },
    'attesa feedback': { label: 'Attesa feedback', icon: '⏳', bg: 'bg-yellow-50', text: 'text-yellow-800', border: 'border-yellow-300' },
    'chiamare': { label: 'Chiamare', icon: '📞', bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200' },
    'consegnare': { label: 'Consegnare', icon: '🚚', bg: 'bg-lime-50', text: 'text-lime-800', border: 'border-lime-300' },
    'da fare': { label: 'Da fare', icon: '📋', bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-200' },
    'effettuare revisione': { label: 'Effettuare revisione', icon: '🔍', bg: 'bg-violet-50', text: 'text-violet-800', border: 'border-violet-200' },
    'fatturare': { label: 'Fatturare', icon: '💶', bg: 'bg-teal-50', text: 'text-teal-800', border: 'border-teal-200' },
    'firmare': { label: 'Firmare', icon: '✍️', bg: 'bg-rose-50', text: 'text-rose-800', border: 'border-rose-200' },
    'fissare appuntamento': { label: 'Fissare appuntamento', icon: '📅', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
    'inviare mail': { label: 'Inviare mail', icon: '✉️', bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200' },
    'ordinare': { label: 'Ordinare', icon: '🛒', bg: 'bg-pink-50', text: 'text-pink-800', border: 'border-pink-200' },
    'pagare': { label: 'Pagare', icon: '💳', bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-200' },
    'prenotare': { label: 'Prenotare', icon: '🎟️', bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-200' },
    'registrare': { label: 'Registrare', icon: '📝', bg: 'bg-sky-50', text: 'text-sky-800', border: 'border-sky-200' },
    'rispondere': { label: 'Rispondere', icon: '💬', bg: 'bg-indigo-50', text: 'text-indigo-800', border: 'border-indigo-200' },
    'scansionare': { label: 'Scansionare', icon: '📄', bg: 'bg-cyan-50', text: 'text-cyan-800', border: 'border-cyan-200' },
    'stampare': { label: 'Stampare', icon: '🖨️', bg: 'bg-slate-100', text: 'text-slate-800', border: 'border-slate-300' },
  };

  // Gestione ToDo List Commessa
  const [isPunchListModalOpen, setIsPunchListModalOpen] = useState(false);
  const [selectedCommessaForPunchList, setSelectedCommessaForPunchList] = useState<any | null>(null);
  const [punchListFilter, setPunchListFilter] = useState<'all' | 'da_fare' | 'completato'>('all');
  const [newTaskCategoria, setNewTaskCategoria] = useState<string>(TODO_CATEGORIE[0] || 'aggiornare');
  const [newTaskTitolo, setNewTaskTitolo] = useState('');
  const [newTaskDescrizione, setNewTaskDescrizione] = useState('');
  const [newTaskScadenza, setNewTaskScadenza] = useState('');
  const [newTaskAssegnatoA, setNewTaskAssegnatoA] = useState('');
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [editingTask, setEditingTask] = useState<PunchListItem | null>(null);

  // Stati e ref per menu a tendina personalizzati ToDo List (zero flickering)
  const [isCatDropdownOpen, setIsCatDropdownOpen] = useState(false);
  const [isAssDropdownOpen, setIsAssDropdownOpen] = useState(false);
  const catDropdownRef = useRef<HTMLDivElement>(null);
  const assDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutsideDropdowns = (e: MouseEvent) => {
      if (catDropdownRef.current && !catDropdownRef.current.contains(e.target as Node)) {
        setIsCatDropdownOpen(false);
      }
      if (assDropdownRef.current && !assDropdownRef.current.contains(e.target as Node)) {
        setIsAssDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutsideDropdowns);
    return () => document.removeEventListener('mousedown', handleClickOutsideDropdowns);
  }, []);

  // Gestione Modale "I Miei ToDo nelle Commesse" (Attività Da Fare assegnate all'utente attivo)
  const [isMyTasksModalOpen, setIsMyTasksModalOpen] = useState(false);

  interface MyCommessaTaskGroup {
    commessa: any;
    tasks: PunchListItem[];
  }

  // Estrazione di tutte le attività "Da Fare" assegnate all'utente attivo, divise per commessa e ordinate per scadenza
  const myAssignedPendingTasks = useMemo((): MyCommessaTaskGroup[] => {
    if (!myAssociatedName && !userEmail) return [];
    const myNameClean = (myAssociatedName || '').trim();
    const myMailClean = (userEmail || '').trim().toLowerCase();

    const groups: MyCommessaTaskGroup[] = [];

    (commesse || []).forEach(comm => {
      const punchList: PunchListItem[] = comm.punchList || [];
      const myTasks = punchList.filter(t => {
        // Solo compiti non completati ("da_fare")
        if (t.stato !== 'da_fare') return false;
        const ass = (t.assegnatoA || '').trim();
        if (!ass) return false;
        return areNamesEqual(ass, myNameClean) || (myMailClean && ass.toLowerCase().includes(myMailClean.split('@')[0]));
      });

      if (myTasks.length > 0) {
        // Ordina i compiti della commessa per data di scadenza:
        // 1. Quelli con data di scadenza (i più imminenti/scaduti per primi)
        // 2. Quelli senza data di scadenza in fondo (per data di creazione decrescente)
        const sortedTasks = [...myTasks].sort((a, b) => {
          if (a.scadenza && b.scadenza) {
            return a.scadenza.localeCompare(b.scadenza);
          }
          if (a.scadenza && !b.scadenza) return -1;
          if (!a.scadenza && b.scadenza) return 1;
          return (b.creatoIl || '').localeCompare(a.creatoIl || '');
        });

        groups.push({
          commessa: comm,
          tasks: sortedTasks
        });
      }
    });

    // Ordina i gruppi di commesse: quelle con la scadenza più imminente per prime
    return groups.sort((gA, gB) => {
      const minScadA = gA.tasks.find(t => t.scadenza)?.scadenza || '9999-99-99';
      const minScadB = gB.tasks.find(t => t.scadenza)?.scadenza || '9999-99-99';
      if (minScadA !== minScadB) {
        return minScadA.localeCompare(minScadB);
      }
      return (gA.commessa.nome || '').localeCompare(gB.commessa.nome || '');
    });
  }, [commesse, myAssociatedName, userEmail]);

  const totalMyPendingTasksCount = useMemo(() => {
    return myAssignedPendingTasks.reduce((acc, g) => acc + g.tasks.length, 0);
  }, [myAssignedPendingTasks]);

  const handleOpenCommessaToDoFromMyTasks = (comm: any) => {
    setIsMyTasksModalOpen(false);
    setSelectedCommessaForPunchList(comm);
    setPunchListFilter('all');
    setNewTaskTitolo('');
    setNewTaskDescrizione('');
    setNewTaskScadenza('');
    setNewTaskAssegnatoA('');
    setNewTaskCategoria(TODO_CATEGORIE[0] || 'aggiornare');
    setEditingTask(null);
    setIsPunchListModalOpen(true);
  };

  const getScadenzaStatus = (scadenzaStr?: string) => {
    if (!scadenzaStr) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(scadenzaStr);
    target.setHours(0, 0, 0, 0);

    const diffTime = target.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    const parts = scadenzaStr.split('-');
    const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : scadenzaStr;

    if (diffDays < 0) {
      return {
        label: `Scaduto il ${formattedDate}`,
        subLabel: `${Math.abs(diffDays)} gg fa`,
        isOverdue: true,
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 font-bold',
        cardBorderClass: 'border-rose-300 bg-rose-50/20'
      };
    } else if (diffDays === 0) {
      return {
        label: `Scade Oggi (${formattedDate})`,
        subLabel: 'Oggi',
        isToday: true,
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-300 font-black',
        cardBorderClass: 'border-amber-300 bg-amber-50/20'
      };
    } else if (diffDays === 1) {
      return {
        label: `Scade Domani (${formattedDate})`,
        subLabel: 'Domani',
        isNear: true,
        badgeClass: 'bg-orange-50 text-orange-700 border-orange-200 font-bold',
        cardBorderClass: 'border-orange-200'
      };
    } else {
      return {
        label: `Entro il ${formattedDate}`,
        subLabel: `tra ${diffDays} gg`,
        isFuture: true,
        badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 font-medium',
        cardBorderClass: 'border-gray-200'
      };
    }
  };

  // Helper per estrarre ESCLUSIVAMENTE le risorse pianificate sulla commessa + Resp e PM
  const getEligibleAssigneesForCommessa = (comm: any, currentTaskAssignee?: string): string[] => {
    if (!comm) return [];
    const assignedNamesSet = new Set<string>();

    // 1. Risorse con assegnazioni attive sulla commessa nella pianificazione
    if (assignments) {
      Object.entries(assignments).forEach(([key, listAss]) => {
        if (!listAss || !Array.isArray(listAss)) return;
        const match = key.match(/^(.*)-(\d{4}-W\d{1,2})$/);
        const dipName = match ? match[1] : key.split('-')[0];
        if (!dipName) return;

        const hasAssignment = listAss.some(ass => ass && ass.commessaId === comm.id && Number(ass.percentuale) > 0);
        if (hasAssignment) {
          const foundDip = (dipendenti || []).find(d => areNamesEqual(d.nome, dipName));
          assignedNamesSet.add(foundDip ? foundDip.nome : dipName);
        }
      });
    }

    // 2. Eventuali risorse assegnate direttamente nel catalogo commessa
    if (Array.isArray(comm.assegnati)) {
      comm.assegnati.forEach((a: any) => {
        const aName = typeof a === 'string' ? a : (a?.nome || a?.name);
        if (aName) {
          const found = (dipendenti || []).find(d => areNamesEqual(d.nome, aName));
          assignedNamesSet.add(found ? found.nome : aName);
        }
      });
    }

    // 3. Responsabile di Commessa
    if (comm.responsabile) {
      const foundResp = (dipendenti || []).find(d => areNamesEqual(d.nome, comm.responsabile));
      assignedNamesSet.add(foundResp ? foundResp.nome : comm.responsabile);
    }

    // 4. Project Manager (PM) della Commessa (singolo o multiplo)
    const pms = Array.isArray(comm.pm) ? comm.pm : (comm.pm ? [comm.pm] : []);
    pms.forEach((pm: string) => {
      if (pm) {
        const foundPm = (dipendenti || []).find(d => areNamesEqual(d.nome, pm));
        assignedNamesSet.add(foundPm ? foundPm.nome : pm);
      }
    });

    // 5. Risorsa già assegnata al task (per preservare assegnazioni storiche durante l'editing)
    if (currentTaskAssignee) {
      assignedNamesSet.add(currentTaskAssignee);
    }

    return Array.from(assignedNamesSet).filter(Boolean).sort((a, b) => a.localeCompare(b));
  };

  // Verifica se l'utente ha ruolo di coordinatore, responsabile, PM o direzione sulla commessa
  const isManagerOfCommessa = (comm?: any): boolean => {
    if (!comm) return false;
    if (isAdmin || isSoci(myAssociatedName) || isDev || isGestoreCommesse) return true;

    // 1. Responsabile di Commessa
    if (comm.responsabile && (areNamesEqual(comm.responsabile, myAssociatedName) || (userEmail && comm.responsabile.toLowerCase().includes(userEmail.split('@')[0])))) {
      return true;
    }

    // 2. Project Manager (PM)
    const pms = Array.isArray(comm.pm) ? comm.pm : (comm.pm ? [comm.pm] : []);
    if (pms.some((p: string) => areNamesEqual(p, myAssociatedName) || (userEmail && p.toLowerCase().includes(userEmail.split('@')[0])))) {
      return true;
    }

    // 3. Coordinatori d'Area / Aziendali
    const uClean = (userEmail || '').toLowerCase().trim();
    const nClean = (myAssociatedName || '').toLowerCase().trim();
    const isCoord = (coordinatori || []).some(c => {
      const cEmail = (c.email || '').toLowerCase().trim();
      if (cEmail && uClean && (cEmail === uClean || cEmail.includes(uClean) || uClean.includes(cEmail))) return true;
      const cUser = cEmail.split('@')[0];
      const uUser = uClean.split('@')[0];
      if (cUser && uUser && (cUser.includes(uUser) || uUser.includes(cUser))) return true;
      return false;
    }) || uClean.includes('badalassi') || uClean.includes('taddei') || nClean.includes('badalassi') || nClean.includes('taddei')
       || uClean.includes('romanello') || nClean.includes('romanello')
       || uClean.includes('bondi') || nClean.includes('bondi')
       || uClean.includes('votino') || nClean.includes('votino')
       || uClean.includes('corbellini') || nClean.includes('corbellini');

    return isCoord;
  };

  // Chiunque lavori alla commessa può inserire punti
  const canUserAddToPunchList = (_comm?: any) => {
    return true; // Tutti gli utenti della ditta possono inserire punti ToDo nelle commesse attive
  };

  // Chi può spuntare come completato / riaprire: Assegnatario oppure Manager/Coordinatori/PM
  const canUserToggleTask = (task: PunchListItem, comm?: any) => {
    const targetComm = comm || selectedCommessaForPunchList;
    if (isManagerOfCommessa(targetComm)) return true;
    if (task.assegnatoA && (areNamesEqual(task.assegnatoA, myAssociatedName) || (userEmail && task.assegnatoA.toLowerCase().includes(userEmail.split('@')[0])))) {
      return true;
    }
    return false;
  };

  // Chi può modificare o eliminare: Autore del punto oppure Manager/Coordinatori/PM
  const canUserEditOrDeleteTask = (task: PunchListItem, comm?: any) => {
    const targetComm = comm || selectedCommessaForPunchList;
    if (isManagerOfCommessa(targetComm)) return true;
    if (task.creatoDa && (areNamesEqual(task.creatoDa, myAssociatedName) || task.creatoDa.toLowerCase() === (userEmail || '').toLowerCase())) {
      return true;
    }
    return false;
  };

  const sanitizePunchListForFirestore = (list: PunchListItem[]): any[] => {
    return list.map(item => {
      const rawState = item.stato || 'da_fare';
      const cleanState = (rawState === 'completato' || rawState === 'eseguito') ? 'completato' : 'da_fare';
      const cleanItem: Record<string, any> = {
        id: item.id || `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        categoria: item.categoria || 'da fare',
        titolo: item.titolo ? item.titolo.trim() : '',
        stato: cleanState,
        assegnatoA: item.assegnatoA ? item.assegnatoA.trim() : '',
        creatoDa: item.creatoDa || 'Utente',
        creatoIl: item.creatoIl || new Date().toISOString()
      };
      if (item.descrizione && item.descrizione.trim()) cleanItem.descrizione = item.descrizione.trim();
      if (item.scadenza) cleanItem.scadenza = item.scadenza;
      if (item.completatoDa) cleanItem.completatoDa = item.completatoDa;
      if (item.completatoIl) cleanItem.completatoIl = item.completatoIl;
      if (item.approvatoDa) cleanItem.approvatoDa = item.approvatoDa;
      if (item.approvatoIl) cleanItem.approvatoIl = item.approvatoIl;
      if (item.noteRevisione && item.noteRevisione.trim()) cleanItem.noteRevisione = item.noteRevisione.trim();
      return cleanItem;
    });
  };

  const handleSavePunchListToFirestore = async (commId: string, updatedList: PunchListItem[]) => {
    const cleanList = sanitizePunchListForFirestore(updatedList);
    await updateDoc(doc(db, 'catalogo_commesse', commId), {
      punchList: cleanList
    });
    // Aggiornamento immediato stato locale
    if (selectedCommessaForPunchList && selectedCommessaForPunchList.id === commId) {
      setSelectedCommessaForPunchList({ ...selectedCommessaForPunchList, punchList: cleanList });
    }
    const target = commesse.find(c => c.id === commId);
    if (target) {
      target.punchList = cleanList;
    }
    if (infoModalCommessa && infoModalCommessa.id === commId) {
      setInfoModalCommessa({ ...infoModalCommessa, punchList: cleanList });
    }
    if (loadPlanningData) loadPlanningData();
  };

  const handleAddOrEditPunchTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCommessaForPunchList) return;
    if (!newTaskTitolo.trim()) {
      showToast("Inserisci la descrizione dell'attività.", "warning");
      return;
    }
    if (!newTaskAssegnatoA.trim()) {
      showToast("Seleziona obbligatoriamente la risorsa assegnata.", "warning");
      return;
    }

    setIsSavingTask(true);
    try {
      const commId = selectedCommessaForPunchList.id;
      const currentList: PunchListItem[] = selectedCommessaForPunchList.punchList || [];
      let updatedList: PunchListItem[] = [];

      if (editingTask) {
        // Controllo permessi modifica
        if (!canUserEditOrDeleteTask(editingTask, selectedCommessaForPunchList)) {
          showToast("Puoi modificare solo i punti che hai creato tu, a meno che tu non sia Coordinatore/Responsabile/PM.", "error");
          setIsSavingTask(false);
          return;
        }

        updatedList = currentList.map(t => {
          if (t.id === editingTask.id) {
            const updated: PunchListItem = {
              ...t,
              categoria: newTaskCategoria || TODO_CATEGORIE[0] || 'aggiornare',
              titolo: newTaskTitolo.trim(),
              assegnatoA: newTaskAssegnatoA.trim()
            };
            if (newTaskDescrizione.trim()) updated.descrizione = newTaskDescrizione.trim();
            else delete updated.descrizione;

            if (newTaskScadenza) updated.scadenza = newTaskScadenza;
            else delete updated.scadenza;

            return updated;
          }
          return t;
        });
        showToast("Punto ToDo aggiornato con successo!", "success");
      } else {
        // Nuovo task creato
        const newTask: PunchListItem = {
          id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          categoria: newTaskCategoria || TODO_CATEGORIE[0] || 'aggiornare',
          titolo: newTaskTitolo.trim(),
          assegnatoA: newTaskAssegnatoA.trim(),
          stato: 'da_fare',
          creatoDa: myAssociatedName || userEmail || 'Utente',
          creatoIl: new Date().toISOString()
        };
        if (newTaskDescrizione.trim()) newTask.descrizione = newTaskDescrizione.trim();
        if (newTaskScadenza) newTask.scadenza = newTaskScadenza;

        updatedList = [newTask, ...currentList];
        showToast(`Nuova voce [${newTask.categoria}] aggiunta alla ToDo List!`, "success");
      }

      await handleSavePunchListToFirestore(commId, updatedList);
      setNewTaskTitolo('');
      setNewTaskDescrizione('');
      setNewTaskScadenza('');
      setNewTaskAssegnatoA('');
      setNewTaskCategoria(TODO_CATEGORIE[0] || 'aggiornare');
      setEditingTask(null);
    } catch (err: any) {
      console.error("Errore salvataggio task:", err);
      showToast("Errore durante il salvataggio della voce ToDo: " + err.message, "error");
    } finally {
      setIsSavingTask(false);
    }
  };

  const handleChangeTaskStatus = async (task: PunchListItem, nextStatus: 'da_fare' | 'completato', customComm?: any) => {
    const comm = customComm || selectedCommessaForPunchList;
    if (!comm) return;
    if (!canUserToggleTask(task, comm)) {
      showToast(`Solo ${task.assegnatoA || 'la risorsa assegnata'} o i Coordinatori/Responsabili/PM possono spuntare questa attività.`, "warning");
      return;
    }
    const commId = comm.id;
    const currentList: PunchListItem[] = comm.punchList || [];

    const nowIso = new Date().toISOString();
    const updaterName = myAssociatedName || userEmail || 'Utente';

    const updatedList = currentList.map(t => {
      if (t.id === task.id) {
        const updated: PunchListItem = { ...t, stato: nextStatus };
        if (nextStatus === 'completato') {
          updated.completatoDa = updaterName;
          updated.completatoIl = nowIso;
        } else if (nextStatus === 'da_fare') {
          delete updated.completatoDa;
          delete updated.completatoIl;
          delete updated.approvatoDa;
          delete updated.approvatoIl;
        }
        return updated;
      }
      return t;
    });

    try {
      await handleSavePunchListToFirestore(commId, updatedList);

      if (nextStatus === 'completato') {
        showToast("✓ Voce ToDo completata!", "success");
      } else {
        showToast("Spunta rimossa: voce ToDo riportata a 'Da Fare'.", "info" as any);
      }
    } catch (err: any) {
      console.error("Errore cambio stato task:", err);
      showToast("Errore durante l'aggiornamento dello stato: " + err.message, "error");
    }
  };

  const handleDeletePunchTask = async (task: PunchListItem) => {
    if (!selectedCommessaForPunchList) return;
    const comm = selectedCommessaForPunchList;
    if (!canUserEditOrDeleteTask(task, comm)) {
      showToast("Puoi eliminare solo i punti che hai creato tu, a meno che tu non sia Coordinatore/Responsabile/PM.", "error");
      return;
    }
    setConfirmConfig({
      isOpen: true,
      title: "Elimina Voce ToDo",
      message: `Sei sicuro di voler eliminare la voce "${task.titolo}" dalla ToDo List?`,
      type: "danger",
      onConfirm: async () => {
        const commId = selectedCommessaForPunchList.id;
        const currentList: PunchListItem[] = selectedCommessaForPunchList.punchList || [];
        const updatedList = currentList.filter(t => t.id !== task.id);
        try {
          await handleSavePunchListToFirestore(commId, updatedList);
          showToast("Voce ToDo eliminata.", "success");
        } catch (err: any) {
          showToast("Errore: " + err.message, "error");
        } finally {
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  // Helper per calcolare le date di inizio e fine lunedì/domenica di una settimana ID
  const getWeekDateRange = (wkId: string) => {
    const parts = wkId.split('-W');
    if (parts.length !== 2) return { startStr: '', endStr: '' };
    const year = parseInt(parts[0]);
    const week = parseInt(parts[1]);
    if (isNaN(year) || isNaN(week)) return { startStr: '', endStr: '' };

    const simple = new Date(year, 0, 4);
    const dayOfWeek = simple.getDay();
    const dayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const firstMonday = new Date(simple.setDate(simple.getDate() + dayOffset));
    const monday = new Date(firstMonday.setDate(firstMonday.getDate() + (week - 1) * 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const startStr = monday.toLocaleDateString('sv-SE');
    const endStr = sunday.toLocaleDateString('sv-SE');
    return { startStr, endStr };
  };

  // Modale Richiedi Personale — [Area] (Sostituisce vecchia modale richiesta coordinatore)
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isSelfChangeRequest, setIsSelfChangeRequest] = useState(false);
  const [reqAreaTarget, setReqAreaTarget] = useState('Disegnatori');
  const [reqCommessaId, setReqCommessaId] = useState('');
  const [reqDataInizio, setReqDataInizio] = useState('');
  const [reqDataFine, setReqDataFine] = useState('');
  const [reqPercentuale, setReqPercentuale] = useState<number>(100);
  const [reqPreferredResource, setReqPreferredResource] = useState('');
  const [reqNota, setReqNota] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  const selectableWeekOptions = useMemo(() => {
    const options: { id: string; mondayStr: string; sundayStr: string; label: string; weekNum: number; year: number }[] = [];
    const today = new Date();
    let currentMonday = getStartOfWeek(addDays(today, -84));
    const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

    for (let i = 0; i < 80; i++) {
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
        label: `Sett. ${wkNum} (${startFormatted} - ${endFormatted})`,
        weekNum: wkNum,
        year: y
      });

      currentMonday = addDays(currentMonday, 7);
    }
    return options;
  }, []);

  const handleReqDateInputChange = (dateStr: string, isStart: boolean) => {
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
      if (reqDataFine && reqDataFine < sunStr) {
        setReqDataFine(sunStr);
      }
    } else {
      setReqDataFine(sunStr);
      if (reqDataInizio && reqDataInizio > monStr) {
        setReqDataInizio(monStr);
      }
    }
  };

  const [planningModal, setPlanningModal] = useState<{
    isOpen: boolean;
    tab?: 'commessa' | 'risorsa' | 'sostituisci';
    commessaId?: string;
    risorsa?: string;
    weekId?: string;
  }>({ isOpen: false });

  const handleResourcePillClick = (e: React.MouseEvent, personName: string, personPct: number, commId: string, _commNome: string, wkId: string, _wkLabel: string) => {
    e.stopPropagation();

    const dip = dipendenti.find(d => areNamesEqual(d.nome, personName));
    const macroArea = dip?.macroArea || '';
    const isResourceInMyCoordinatedArea = myCoordinatedAreas.some(a => (a || '').toLowerCase().trim() === macroArea.toLowerCase().trim());
    const isSelfPerson = areNamesEqual(personName, myAssociatedName);

    // Solo Admin, Soci e il Coordinatore della SPECIFICA area a cui appartiene la risorsa possono modificarla direttamente
    const canDirectlyManage = isAdmin || isSoci(myAssociatedName) || isResourceInMyCoordinatedArea;

    if (e.button === 1) {
      // Rotellina (Middle Click) -> Nuova Scheda
      if (canDirectlyManage) {
        window.open(`/pianificazione-personale?tab=risorsa&risorsa=${encodeURIComponent(personName)}&weekId=${encodeURIComponent(wkId)}`, '_blank');
      }
      return;
    }

    if (canDirectlyManage) {
      // Tasto Sinistro (Left Click) -> Modale di Gestione Diretta
      setPlanningModal({
        isOpen: true,
        tab: 'risorsa',
        risorsa: personName,
        commessaId: commId,
        weekId: wkId
      });
    } else {
      // Risorsa di ALTRA area -> Apre sempre la Modale per Richiedere la Modifica al Coordinatore dell'area di appartenenza
      const weekRange = getWeekDateRange(wkId);
      const isSelf = isSelfPerson;
      setIsSelfChangeRequest(isSelf);
      setReqAreaTarget(macroArea || 'Disegnatori');
      setReqCommessaId(commId);
      setReqPreferredResource(personName && dipendenti.some(d => d.nome === personName) ? personName : '');
      setReqPercentuale(personPct || 100);
      setReqDataInizio(weekRange.startStr);
      setReqDataFine(weekRange.endStr);
      setReqNota('');
      setIsRequestModalOpen(true);
    }
  };

  const handleWeekCellClick = (e: React.MouseEvent, comm: any, wk: any) => {
    if (e.button !== 0) return;
    e.preventDefault();

    const isPMOrRespOfCommessa = (cObj: any): boolean => {
      if (!cObj) return false;
      const respStr = String(cObj.responsabile || '').toLowerCase().trim();
      const pmList: any[] = Array.isArray(cObj.pm) ? cObj.pm : (cObj.pm ? [cObj.pm] : []);
      const targets = [respStr, ...pmList.map(p => String(p || '').toLowerCase().trim())].filter(Boolean);

      if (targets.length === 0) return false;

      if (myAssociatedName && targets.some(t => areNamesEqual(t, myAssociatedName))) return true;

      if (userEmail) {
        const emailClean = userEmail.toLowerCase().trim();
        const username = emailClean.split('@')[0];
        if (targets.some(t => t.includes(emailClean) || (username.length >= 4 && t.includes(username)))) return true;
      }

      const commonFirstNames = ['andrea', 'matteo', 'marco', 'gabriele', 'luca', 'francesco', 'alessandro', 'stefano', 'davide', 'lorenzo', 'riccardo', 'filippo', 'giuseppe', 'antonio', 'michele'];
      const fullName = myAssociatedName || '';
      if (fullName) {
        const parts = fullName.split(/\s+/).filter(p => p.length >= 3);
        for (const part of parts) {
          const partLower = part.toLowerCase();
          if (parts.length > 1 && commonFirstNames.includes(partLower)) {
            continue;
          }
          if (targets.some(t => t.includes(partLower))) return true;
        }
      }

      return false;
    };

    const canDirectlyManageWeek = isAdmin || isSoci(myAssociatedName) || isPMOrRespOfCommessa(comm);

    if (canDirectlyManageWeek) {
      setPlanningModal({
        isOpen: true,
        tab: 'commessa',
        commessaId: comm.id,
        weekId: wk.id
      });
    } else {
      const isAnyCoordinator = (coordinatori || []).some(c => c.email?.toLowerCase() === userEmail?.toLowerCase());
      if (isAnyCoordinator) {
        const myDip = dipendenti.find(d => areNamesEqual(d.nome, myAssociatedName));
        const macroArea = myDip?.macroArea || 'Disegnatori';
        const weekRange = getWeekDateRange(wk.id);
        setIsSelfChangeRequest(false);
        setReqAreaTarget(macroArea);
        setReqCommessaId(comm.id);
        setReqPreferredResource('');
        setReqPercentuale(100);
        setReqDataInizio(weekRange.startStr);
        setReqDataFine(weekRange.endStr);
        setReqNota('');
        setIsRequestModalOpen(true);
      }
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqCommessaId || !reqDataInizio || !reqDataFine || !reqPercentuale) {
      showToast("Compila tutti i campi richiesti.", "warning");
      return;
    }
    setIsSubmittingRequest(true);
    try {
      const commObj = commesse.find(c => c.id === reqCommessaId);
      const commName = commObj ? commObj.nome : '';
      
      const isAltreCommessa = Boolean(selectedAltreCommessa && selectedAltreCommessa.id === reqCommessaId);
      const finalTipoRichiesta = isAltreCommessa ? 'inserimento_commessa' : (isSelfChangeRequest ? 'modifica_assegnazione' : 'richiesta_area');

      await addDoc(collection(db, 'richieste_disegnatori'), {
        commessaId: reqCommessaId,
        commessaName: commName,
        commessaNome: commName,
        commessaResponsabile: commObj?.responsabile || '',
        commessaPM: commObj?.pm || [],
        dataInizio: reqDataInizio,
        dataFine: reqDataFine,
        percentuale: Number(reqPercentuale),
        risorsaPreferita: reqPreferredResource || (isSelfChangeRequest ? myAssociatedName : ''),
        nota: reqNota,
        richiedenteNome: myAssociatedName || userEmail || '',
        richiedenteEmail: userEmail,
        stato: 'in_attesa',
        area: reqAreaTarget,
        tipoRichiesta: finalTipoRichiesta,
        fonte: isAltreCommessa ? 'altre_commesse' : 'planning',
        createdAt: new Date().toISOString()
      });

      const targetEmails = new Set<string>();

      // Email dei coordinatori dell'area
      (coordinatori || [])
        .filter(c => c.area === reqAreaTarget && c.email)
        .forEach(c => targetEmails.add(c.email.toLowerCase()));

      // Email del Responsabile e PM della commessa
      if (commObj) {
        if (commObj.responsabile) {
          const respDip = dipendenti.find(d => areNamesEqual(d.nome, commObj.responsabile));
          if (respDip?.email) targetEmails.add(respDip.email.toLowerCase());
        }
        const pmArray = Array.isArray(commObj.pm) ? commObj.pm : (commObj.pm ? [commObj.pm] : []);
        pmArray.forEach(p => {
          const pmDip = dipendenti.find(d => areNamesEqual(d.nome, p));
          if (pmDip?.email) targetEmails.add(pmDip.email.toLowerCase());
        });
      }

      showToast(isSelfChangeRequest ? "Richiesta di modifica inviata con successo!" : `Richiesta ${reqAreaTarget} inviata con successo!`, "success");
      setIsRequestModalOpen(false);
      setIsSelfChangeRequest(false);
      setReqCommessaId('');
      setReqDataInizio('');
      setReqDataFine('');
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


  // const handleSelectCommessaFilter = (commId: string) => {
  //   if (commId) {
  //     setSelectedCommessaIdsFilter([commId]);
  //     const comm = commesse.find(c => c.id === commId);
  //     if (comm && comm.dataInizio && comm.dataFine) {
  //       const start = new Date(comm.dataInizio);
  //       const end = new Date(comm.dataFine);
  //       const diffTime = Math.abs(end.getTime() - start.getTime());
  //       const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  //       const numWks = Math.max(2, Math.min(52, Math.ceil(diffDays / 7)));
  //       
  //       setBaseDate(getStartOfWeek(start));
  //       setZoomWeeks(numWks);
  //     }
  //   } else {
  //     setSelectedCommessaIdsFilter([]);
  //     setBaseDate(new Date());
  //     setZoomWeeks(10); // Reset to default 10 weeks
  //   }
  // };
  




  // Dynamically determine baseDate and number of weeks if a single commessa is selected
  const activeWeeks = useMemo(() => {
    return generateWeeksExtended(baseDate, zoomWeeks);
  }, [baseDate, zoomWeeks]);

  const weeksRangeMap = useMemo(() => {
    const map = new Map<string, { wkStartMs: number; wkEndMs: number }>();
    activeWeeks.forEach(wk => {
      if (wk.dateObj) {
        const wkStart = new Date(wk.dateObj);
        wkStart.setHours(0, 0, 0, 0);
        const wkEnd = new Date(wkStart);
        wkEnd.setDate(wkStart.getDate() + 6);
        wkEnd.setHours(23, 59, 59, 999);
        map.set(wk.id, { wkStartMs: wkStart.getTime(), wkEndMs: wkEnd.getTime() });
      }
    });
    return map;
  }, [activeWeeks]);

  const getMonthYearLabel = (dateObj?: Date) => {
    if (!dateObj) return '';
    const months = [
      'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
      'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
    ];
    return `${months[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
  };

  const monthSpans = useMemo(() => {
    const spans: { label: string; colSpan: number }[] = [];
    activeWeeks.forEach(wk => {
      const label = getMonthYearLabel(wk.dateObj);
      if (spans.length > 0 && spans[spans.length - 1].label === label) {
        spans[spans.length - 1].colSpan += 1;
      } else {
        spans.push({ label, colSpan: 1 });
      }
    });
    return spans;
  }, [activeWeeks]);

  const handleExportToExcel = () => {
    let csvContent = "\uFEFF"; // UTF-8 BOM
    
    // Headers
    const headers = ["Cliente", "Codice/Nome Commessa", "Responsabile", "PM", "Data Inizio", "Data Fine"];
    activeWeeks.forEach(wk => {
      headers.push(`${wk.label} (${wk.sub})`);
    });
    csvContent += headers.join(";") + "\n";

    // Righe
    filteredCommesse.forEach(comm => {
      const pmArray = Array.isArray(comm.pm) ? comm.pm : (comm.pm ? [comm.pm] : []);
      const pmStr = pmArray.join(', ');
      const row = [
        comm.cliente || "Altri Clienti",
        comm.nome,
        comm.responsabile || "",
        pmStr,
        comm.dataInizio ? formatDate(comm.dataInizio) : "",
        comm.dataFine ? formatDate(comm.dataFine) : ""
      ];
        
        activeWeeks.forEach(wk => {
          const assignedPeople = getAssignmentsForCommessaInWeek(comm.id, wk.id);
          const peopleStr = assignedPeople.map(p => {
            const daysStr = p.giorni ? ` (${p.giorni.join(',')})` : '';
            return `${p.name} [${p.pct}%${daysStr}]`;
          }).join(" | ");
          row.push(peopleStr || "Nessuno");
        });
        
        csvContent += row.map(val => `"${val.replace(/"/g, '""')}"`).join(";") + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Pianificazione_Commesse_${activeWeeks[0].id}_a_${activeWeeks[activeWeeks.length - 1].id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isUserPmOrRespOfCommessa = (cObj: any): boolean => {
    if (!cObj) return false;
    const respStr = String(cObj.responsabile || '').toLowerCase().trim();
    const pmList: any[] = Array.isArray(cObj.pm) ? cObj.pm : (cObj.pm ? [cObj.pm] : []);
    const targets = [respStr, ...pmList.map(p => String(p || '').toLowerCase().trim())].filter(Boolean);

    if (targets.length === 0) return false;

    if (myAssociatedName && targets.some(t => areNamesEqual(t, myAssociatedName))) return true;
    if (myDip?.nome && targets.some(t => areNamesEqual(t, myDip.nome))) return true;

    if (userEmail) {
      const emailClean = userEmail.toLowerCase().trim();
      const username = emailClean.split('@')[0];
      if (targets.some(t => t.includes(emailClean) || (username.length >= 4 && t.includes(username)))) return true;
    }

    return false;
  };

  // Filtra commesse con filtri avanzati ed in ordine alfabetico (solo commesse Aperte nella timeline/pianificazione)
  const filteredCommesse = useMemo(() => {
    let list = commesse.filter(c => (c.stato || 'Aperta') !== 'Chiusa');

    // Filtro per multi-selezione commesse
    if (selectedCommessaIdsFilter.length > 0) {
      list = list.filter(c => selectedCommessaIdsFilter.includes(c.id));
    }

    // Filtro per Cliente (case-insensitive ed unico)
    if (selectedClientFilter) {
      list = list.filter(c => areNamesEqual(c.cliente, selectedClientFilter));
    }

    // Filtro per Responsabile
    if (selectedPMFilter) {
      list = list.filter(c => areNamesEqual(c.responsabile, selectedPMFilter));
    }

    // Filtro per Tipologia
    if (selectedTipologiaFilter) {
      list = list.filter(c => c.tipologia === selectedTipologiaFilter);
    }

    if (commessaTextQuery.trim()) {
      const query = commessaTextQuery.toLowerCase().trim();
      list = list.filter(c => {
        const name = (c.nome || '').toLowerCase();
        const code = ((c as any).codiceCommessa || '').toLowerCase();
        const titolo = ((c as any).titolo || '').toLowerCase();
        const cliente = ((c as any).cliente || '').toLowerCase();
        const resp = (c.responsabile || '').toLowerCase();
        const pmArray = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
        const pm = pmArray.join(', ').toLowerCase();
        return name.includes(query) ||
               code.includes(query) ||
               titolo.includes(query) ||
               cliente.includes(query) ||
               resp.includes(query) ||
               pm.includes(query);
      });
    }

    // Filtro per dipendenti, PM e coordinatori (che vedono solo quelle a cui sono assegnati o dove sono PM/Resp)
    if (!isAdmin && !isSoci(myAssociatedName) && myAssociatedName) {
      const assignedCommessaIds = new Set<string>();
      Object.entries(assignments).forEach(([key, listAss]) => {
        const keyName = key.split('-')[0];
        if (areNamesEqual(keyName, myAssociatedName) || key.startsWith(`${myAssociatedName}-`)) {
          listAss.forEach(ass => {
            if (ass.percentuale > 0) {
              assignedCommessaIds.add(ass.commessaId);
            }
          });
        }
      });

      list = list.filter(c => assignedCommessaIds.has(c.id) || isUserPmOrRespOfCommessa(c));
    }

    // Ordine alfabetico
    return [...list].sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  }, [commesse, selectedCommessaIdsFilter, selectedClientFilter, selectedPMFilter, selectedTipologiaFilter, commessaTextQuery, isAdmin, myAssociatedName, assignments, userEmail, myDip]);

  // Pre-calcolo delle ferie settimanali full-week in O(L)
  const fullWeekLeavesSet = useMemo(() => {
    const set = new Set<string>();
    if (!approvedLeaves || !approvedLeaves.length || !activeWeeks || !activeWeeks.length) return set;

    (approvedLeaves || []).forEach(leave => {
      if (!leave || !leave.dipendenteName) return;
      const resName = leave.dipendenteName;
      const isFullDay = leave.tipo === 'ferie' || 
                        leave.tipo === 'malattia' || 
                        leave.tipo === 'maternita' || 
                        (leave.tipo !== 'smart' && leave.tipo !== 'permesso' && leave.tipo !== 'ex_l104' && leave.tipo !== 'studio' && leave.tipo !== 'mattina' && leave.tipo !== 'pomeriggio');
      if (!isFullDay) return;

      const start = typeof leave.dataInizio === 'string' ? leave.dataInizio : (typeof leave.data === 'string' ? leave.data : null);
      const end = typeof leave.dataFine === 'string' ? leave.dataFine : (typeof leave.data === 'string' ? leave.data : null);
      if (start && end && start.includes('-') && end.includes('-')) {
        const [sY, sM, sD] = start.split('-').map(Number);
        const [eY, eM, eD] = end.split('-').map(Number);
        if (!isNaN(sY) && !isNaN(sM) && !isNaN(sD) && !isNaN(eY) && !isNaN(eM) && !isNaN(eD)) {
          const curr = new Date(sY, sM - 1, sD);
          const last = new Date(eY, eM - 1, eD);

          activeWeeks.forEach(wk => {
            const parts = wk.id.split('-W');
            if (parts.length !== 2) return;
            const year = parseInt(parts[0]);
            const week = parseInt(parts[1]);
            if (isNaN(year) || isNaN(week)) return;

            const simple = new Date(year, 0, 4);
            const dayOfWeek = simple.getDay();
            const dayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
            const firstMonday = new Date(simple.setDate(simple.getDate() + dayOffset));
            const monday = new Date(firstMonday.setDate(firstMonday.getDate() + (week - 1) * 7));

            let count = 0;
            for (let i = 0; i < 5; i++) {
              const dObj = new Date(monday);
              dObj.setDate(monday.getDate() + i);
              if (dObj >= curr && dObj <= last) {
                count++;
              }
            }
            if (count >= 5) {
              set.add(`${resName.toLowerCase()}-${wk.id}`);
            }
          });
        }
      }
    });

    return set;
  }, [approvedLeaves, activeWeeks]);

  // Pre-calcolo mappa delle assegnazioni commessa per lookup O(1) ultra-veloce
  const commessaAssignmentsMap = useMemo(() => {
    const map = new Map<string, { name: string; pct: number; giorni?: string[] }[]>();
    if (!assignments || !dipendenti) return map;

    const validDipNames = new Set((dipendenti || []).map(d => (d && d.nome) ? d.nome : '').filter(Boolean));

    Object.entries(assignments).forEach(([key, listAss]) => {
      if (!listAss || !listAss.length) return;
      const match = key.match(/^(.*)-(\d{4}-W\d{1,2})$/);
      if (!match) return;
      const dipName = match[1];
      const wkId = match[2];

      if (!validDipNames.has(dipName)) return;

      // Escludi risorsa se in ferie tutta la settimana
      if (fullWeekLeavesSet.has(`${dipName.toLowerCase()}-${wkId}`)) return;

      listAss.forEach(ass => {
        if (!ass || !ass.commessaId || !ass.percentuale) return;
        const cellKey = `${ass.commessaId}-${wkId}`;
        const existing = map.get(cellKey) || [];
        existing.push({ name: dipName, pct: ass.percentuale, giorni: ass.giorni });
        map.set(cellKey, existing);
      });
    });

    return map;
  }, [assignments, dipendenti, fullWeekLeavesSet]);

  // Lookup O(1) istantaneo
  const getAssignmentsForCommessaInWeek = (commId: string, wkId: string) => {
    return commessaAssignmentsMap.get(`${commId}-${wkId}`) || [];
  };

  const dipendentiMap = useMemo(() => {
    const map = new Map<string, any>();
    (dipendenti || []).forEach(d => {
      if (d && d.nome) {
        map.set(d.nome.toLowerCase().trim(), d);
      }
    });
    return map;
  }, [dipendenti]);

  const totalPctInWeekMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!assignments) return map;
    Object.entries(assignments).forEach(([key, listAss]) => {
      if (Array.isArray(listAss)) {
        const total = listAss.reduce((sum: number, a: any) => sum + (a.percentuale || 0), 0);
        map.set(key.toLowerCase().trim(), total);
      }
    });
    return map;
  }, [assignments]);

  const resourceWeekLeavesMap = useMemo(() => {
    const map = new Map<string, { giorno: string; tipo: string; frazioneTipo?: string; oraInizio?: string; oraFine?: string; pausaPranzo?: boolean; pausaPranzoOre?: number; dettagli: string }[]>();
    if (!approvedLeaves || !approvedLeaves.length || !activeWeeks || !activeWeeks.length) return map;

    const dayNames = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
    
    // Cache week dates for activeWeeks
    const weekDatesCache = new Map<string, { dateStrs: string[] }>();
    activeWeeks.forEach(wk => {
      const parts = wk.id.split('-W');
      if (parts.length === 2) {
        const year = parseInt(parts[0]);
        const week = parseInt(parts[1]);
        if (!isNaN(year) && !isNaN(week)) {
          const simple = new Date(year, 0, 4);
          const dayOfWeek = simple.getDay();
          const dayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
          const firstMonday = new Date(simple.setDate(simple.getDate() + dayOffset));
          const monday = new Date(firstMonday.setDate(firstMonday.getDate() + (week - 1) * 7));
          const dateStrs: string[] = [];
          for (let i = 0; i < 5; i++) {
            const dObj = new Date(monday);
            dObj.setDate(monday.getDate() + i);
            const y = dObj.getFullYear();
            const m = String(dObj.getMonth() + 1).padStart(2, '0');
            const ds = String(dObj.getDate()).padStart(2, '0');
            dateStrs.push(`${y}-${m}-${ds}`);
          }
          weekDatesCache.set(wk.id, { dateStrs });
        }
      }
    });

    (approvedLeaves || []).forEach(leave => {
      if (!leave || !leave.dipendenteName) return;
      const resKey = leave.dipendenteName.toLowerCase().trim();
      const start = typeof leave.dataInizio === 'string' ? leave.dataInizio : (typeof leave.data === 'string' ? leave.data : null);
      const end = typeof leave.dataFine === 'string' ? leave.dataFine : (typeof leave.data === 'string' ? leave.data : null);
      if (!start || !end || !start.includes('-') || !end.includes('-')) return;

      const [sY, sM, sD] = start.split('-').map(Number);
      const [eY, eM, eD] = end.split('-').map(Number);
      if (isNaN(sY) || isNaN(sM) || isNaN(sD) || isNaN(eY) || isNaN(eM) || isNaN(eD)) return;

      const curr = new Date(sY, sM - 1, sD).getTime();
      const last = new Date(eY, eM - 1, eD).getTime();

      weekDatesCache.forEach(({ dateStrs }, wkId) => {
        dateStrs.forEach((wDateStr, idx) => {
          const [wY, wM, wD] = wDateStr.split('-').map(Number);
          const wTime = new Date(wY, wM - 1, wD).getTime();
          if (wTime >= curr && wTime <= last) {
            let label = leave.tipo === 'ferie' ? 'Ferie' : leave.tipo === 'malattia' ? 'Malattia' : leave.tipo === 'maternita' ? 'Maternità' : leave.tipo === 'smart' ? 'Smart' : leave.tipo === 'ex_l104' ? 'ex L.104' : leave.tipo === 'studio' ? 'Studio' : (leave.tipo || 'Assenza');
            if (leave.tipo === 'mattina' || leave.frazioneTipo === 'mattina') label = 'Ass. Matt.';
            if (leave.tipo === 'pomeriggio' || leave.frazioneTipo === 'pomeriggio') label = 'Ass. Pom.';
            if (leave.tipo === 'permesso' || leave.tipo === 'ex_l104' || leave.tipo === 'studio' || leave.frazioneTipo === 'orario') {
              if (leave.oraInizio && leave.oraFine) {
                label = `${leave.tipo === 'ex_l104' ? 'L.104' : (leave.tipo === 'studio' ? 'Studio' : 'Perm.')} (${leave.oraInizio}-${leave.oraFine})`;
              }
            }

            const mapKey = `${resKey}_${wkId}`;
            const existing = map.get(mapKey) || [];
            existing.push({
              giorno: dayNames[idx],
              tipo: leave.tipo || 'ferie',
              frazioneTipo: leave.frazioneTipo,
              oraInizio: leave.oraInizio,
              oraFine: leave.oraFine,
              pausaPranzo: leave.pausaPranzo,
              pausaPranzoOre: leave.pausaPranzoOre,
              dettagli: label
            });
            map.set(mapKey, existing);
          }
        });
      });
    });

    return map;
  }, [approvedLeaves, activeWeeks]);



  const shiftPeriod = (weeksOffset: number) => {
    setBaseDate(prev => addDays(prev, weeksOffset * 7));
  };
  
  const resetToToday = () => {
    setBaseDate(new Date());
  };

  const getCommessaTipologiaCode = (c: any): string => {
    if (c.codiceCommessa) {
      const match = String(c.codiceCommessa).trim().match(/^([A-Za-z]+)(\d{2})/);
      if (match) {
        const codeFromPrefix = match[1].toUpperCase();
        if (TIPOLOGIE_COMMESSE[codeFromPrefix]) {
          return codeFromPrefix;
        }
      }
    }

    if (c.tipologia) {
      const raw = String(c.tipologia).trim();
      if (TIPOLOGIE_COMMESSE[raw.toUpperCase()]) {
        return raw.toUpperCase();
      }
      const dashParts = raw.split(' - ');
      if (dashParts[0] && TIPOLOGIE_COMMESSE[dashParts[0].toUpperCase()]) {
        return dashParts[0].toUpperCase();
      }
      const foundKey = Object.keys(TIPOLOGIE_COMMESSE).find(k => 
        TIPOLOGIE_COMMESSE[k].toLowerCase() === raw.toLowerCase()
      );
      if (foundKey) return foundKey;
      return raw.toUpperCase();
    }

    if (c.nome) {
      const match = String(c.nome).trim().match(/^([A-Za-z]+)(\d{2})/);
      if (match) {
        const codeFromPrefix = match[1].toUpperCase();
        if (TIPOLOGIE_COMMESSE[codeFromPrefix]) {
          return codeFromPrefix;
        }
      }
    }

    return '';
  };

  const getParsedField = (c: any, field: 'anno' | 'tipologia' | 'titolo') => {
    if (field === 'tipologia') return getCommessaTipologiaCode(c);
    if (field === 'titolo') return c.titolo || (c.nome && c.nome.includes(' - ') ? c.nome.split(' - ').slice(1).join(' - ') : c.nome) || '';
    if (c.anno) return c.anno;
    if (!c.codiceCommessa) return '';
    const match = c.codiceCommessa.match(/^([A-Za-z]+)(\d{2})/);
    if (!match) return '';
    return `20${match[2]}`;
  };


  const generatedCodiceCommessa = useMemo(() => {
    if (!selectedClient) return '';
    const paddedClientCode = selectedClient.codice.padStart(4, '0');
    return `${newCommessaTipologia}${newCommessaAnno.slice(-2)}${paddedClientCode}${newCommessaLettera}`;
  }, [selectedClient, newCommessaTipologia, newCommessaAnno, newCommessaLettera]);

  const isDuplicateCommessaCode = useMemo(() => {
    if (!generatedCodiceCommessa) return false;
    return commesse.some(c => c.codiceCommessa === generatedCodiceCommessa);
  }, [generatedCodiceCommessa, commesse]);

  useEffect(() => {
    if (selectedClient && newCommessaAnno) {
      const nextLetter = getNextAvailableLetter(
        newCommessaTipologia,
        newCommessaAnno,
        selectedClient.codice,
        commesse
      );
      setNewCommessaLettera(nextLetter);
    }
  }, [selectedClient, newCommessaTipologia, newCommessaAnno, commesse]);

  const responsabiliMacroAreeList = useMemo(() => {
    const explicitEmails = new Set((responsabiliCommesseEmails || []).map(e => (e || '').toLowerCase().trim()).filter(Boolean));
    const sociIdentifiers = ['aprofeti@ingegno06.it', 'mcorbellini@ingegno06.it', 'profeti andrea', 'corbellini matteo', 'profeti', 'corbellini'];

    return (dipendenti || []).filter(d => {
      if (!d || !d.nome) return false;
      const dEmail = (d.email || '').toLowerCase().trim();
      const dNome = d.nome.toLowerCase().trim();
      const isSocio = sociIdentifiers.some(s => dEmail.includes(s) || dNome.includes(s));

      // Se sono presenti Responsabili espliciti configurati in Impostazioni, usa quella lista (+ Soci)
      if (explicitEmails.size > 0) {
        return isSocio || explicitEmails.has(dEmail);
      }

      // Fallback predefinito: esclude esplicitamente Marchetti Davide e Romanello Andrea
      const isExcluded = dEmail.includes('marchetti') || dNome.includes('marchetti') || dEmail.includes('romanello') || dNome.includes('romanello');
      if (isExcluded) return false;

      const coordEmails = new Set((coordinatori || []).map(c => (c && c.email && typeof c.email === 'string') ? c.email.toLowerCase().trim() : '').filter(Boolean));
      return isSocio || coordEmails.has(dEmail);
    });
  }, [dipendenti, coordinatori, responsabiliCommesseEmails]);

  const pmsList = useMemo(() => {
    const safePms = (pmsEmails || []).map(e => (e && typeof e === 'string') ? e.toLowerCase() : '').filter(Boolean);
    return (dipendenti || []).filter(d => d && d.email && typeof d.email === 'string' && safePms.includes(d.email.toLowerCase()));
  }, [dipendenti, pmsEmails]);

  // isResponsabileDiQualcheCommessa rimosso: non più utilizzato dopo la revisione dei permessi.

  const isCoordinatoreQualsiasi = useMemo(() => {
    if (!userEmail) return false;
    const clean = userEmail.toLowerCase().trim();
    return (coordinatori || []).some(c => c && c.email && typeof c.email === 'string' && c.email.toLowerCase().trim() === clean);
  }, [userEmail, coordinatori]);


  const canAccessCatalogo = useMemo(() => {
    return isAdmin || isGestoreCommesse || isSoci(myAssociatedName);
  }, [isAdmin, isGestoreCommesse, myAssociatedName]);

  // Scarica il catalogo completo storico (incluse commesse chiuse) SOLO quando si accede al tab Catalogo
  useEffect(() => {
    if (activeTab === 'gestione' && canAccessCatalogo && loadAllCommesse) {
      loadAllCommesse();
    }
  }, [activeTab, canAccessCatalogo, loadAllCommesse]);

  const canAccessAltreCommesseTab = useMemo(() => {
    if (isSoci(myAssociatedName)) return false;
    return isCoordinatoreQualsiasi && myCoordinatedAreas.length > 0;
  }, [isCoordinatoreQualsiasi, myCoordinatedAreas, myAssociatedName]);

  const canManageCatalogo = useMemo(() => {
    return isAdmin || isGestoreCommesse || isSoci(myAssociatedName);
  }, [isAdmin, isGestoreCommesse, myAssociatedName]);

  const commesseGestibili = useMemo(() => {
    if (canAccessCatalogo) return commesse;
    return commesse.filter(c => {
      const pmArray = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
      const isPM = pmArray.some(name => areNamesEqual(name, myAssociatedName));
      return areNamesEqual(c.responsabile, myAssociatedName) || isPM;
    });
  }, [commesse, canAccessCatalogo, myAssociatedName]);

  const selectableCommesseForRequest = useMemo(() => {
    return (commesse || [])
      .filter(c => (c.stato || 'Aperta') !== 'Chiusa')
      .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  }, [commesse]);

  const selectableAnniCatalogo = useMemo(() => {
    const set = new Set<string>();
    commesseGestibili.forEach(c => {
      const ann = getParsedField(c, 'anno');
      if (ann) set.add(ann);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [commesseGestibili]);

  const selectableClientiCatalogo = useMemo(() => {
    const map = new Map<string, string>();

    // Mappa preliminare dai clienti ufficiali in anagrafica
    (clientiList || []).forEach((cliObj: any) => {
      const name = cliObj.ragioneSociale || cliObj.nome;
      if (name && typeof name === 'string' && name.trim()) {
        const key = name.trim().toLowerCase();
        if (!map.has(key)) map.set(key, name.trim());
      }
    });

    commesseGestibili.forEach(c => {
      const cli = (c as any).cliente;
      if (cli && typeof cli === 'string' && cli.trim()) {
        const key = cli.trim().toLowerCase();
        if (!map.has(key)) {
          map.set(key, cli.trim());
        }
      }
    });

    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
  }, [commesseGestibili, clientiList]);

  const handleUnifyClientNames = async () => {
    if (!commesse || !clientiList || commesse.length === 0 || clientiList.length === 0) return;
    try {
      const officialMap = new Map<string, string>();
      (clientiList || []).forEach((cliObj: any) => {
        const name = cliObj.ragioneSociale || cliObj.nome;
        if (name && typeof name === 'string' && name.trim()) {
          officialMap.set(name.trim().toLowerCase(), name.trim());
        }
      });

      let updatedCount = 0;
      for (const c of commesse) {
        const rawCli = c.cliente;
        if (!rawCli || typeof rawCli !== 'string') continue;
        const key = rawCli.trim().toLowerCase();
        const officialName = officialMap.get(key);

        if (officialName && officialName !== rawCli) {
          const docRef = doc(db, 'catalogo_commesse', c.id);
          await setDoc(docRef, { cliente: officialName }, { merge: true });
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        console.log(`[FIRESTONE CLEANUP] Unificati con successo ${updatedCount} nomi clienti nel database.`);
      }
    } catch (err) {
      console.error("Errore durante l'unificazione nomi clienti:", err);
    }
  };

  useEffect(() => {
    if (canManageCatalogo && commesse && commesse.length > 0 && clientiList && clientiList.length > 0) {
      handleUnifyClientNames();
    }
  }, [canManageCatalogo, commesse, clientiList]);

  useEffect(() => {
    if (activeTab === 'altre-commesse' && !canAccessAltreCommesseTab) {
      setActiveTab('consultazione');
    }
  }, [activeTab, canAccessAltreCommesseTab]);



  const selectableResponsabiliCatalogo = useMemo(() => {
    const set = new Set<string>();
    commesseGestibili.forEach(c => {
      const r = getOfficialName(c.responsabile);
      if (r && r.trim()) set.add(r.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
  }, [commesseGestibili]);

  const selectablePMsCatalogo = useMemo(() => {
    const set = new Set<string>();
    commesseGestibili.forEach(c => {
      const pmArray = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
      pmArray.forEach(p => {
        const pName = getOfficialName(p);
        if (pName && pName.trim()) set.add(pName.trim());
      });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
  }, [commesseGestibili]);

  const handleOpenInfoModal = (c: any) => {
    setInfoModalCommessa(c);
  };

  const handleOpenEditModal = (c: any) => {
    setEditingCommessa(c);
    const extractedTitle = (c as any).titolo || (c.nome && c.nome.includes(' - ') ? c.nome.split(' - ').slice(1).join(' - ') : c.nome) || '';
    setEditTitolo(extractedTitle);
    setEditCliente((c as any).cliente || '');
    setEditAnno(getParsedField(c, 'anno') || new Date().getFullYear().toString());
    setEditTipologia(getCommessaTipologiaCode(c) || 'A');
    setEditStato((c as any).stato || 'Aperta');
    setEditDataInizio((c as any).dataInizio || '');
    setEditDataFine((c as any).dataFine || '');

    // Normalizzazione Responsabile con nome ufficiale
    const rawResp = (c as any).responsabile || '';
    const respOfficial = getOfficialName(rawResp) || rawResp;
    const matchedResp = responsabiliMacroAreeList.find(r => areNamesEqual(r.nome, respOfficial) || areNamesEqual(r.nome, rawResp));
    setEditResponsabile(matchedResp ? matchedResp.nome : respOfficial);

    const progettiList: CommessaProgetto[] = Array.isArray(c.progetti) && c.progetti.length > 0 ? c.progetti : [];
    
    // Normalizzazione PM con nome ufficiale
    const rawPm = (progettiList.length > 0 && progettiList[0].pm) 
      ? progettiList[0].pm 
      : (Array.isArray(c.pm) ? c.pm[0] || '' : c.pm || '');
    const pmOfficial = getOfficialName(rawPm) || rawPm;
    const matchedPM = pmsList.find(p => areNamesEqual(p.nome, pmOfficial) || areNamesEqual(p.nome, rawPm));
    setEditPM(matchedPM ? matchedPM.nome : pmOfficial);

    if (progettiList.length > 0) {
      setEditProgettiDescrizioni(progettiList.map(p => p.descrizione || ''));
      const p0 = progettiList[0];

      const rawUtenti = Array.isArray(p0.utentiDaAbilitare) ? p0.utentiDaAbilitare : (Array.isArray((p0 as any).utentiAbilitati) ? (p0 as any).utentiAbilitati : []);
      const normalizedUtenti = rawUtenti.map((u: string) => {
        const off = getOfficialName(u);
        const found = dipendenti.find(d => areNamesEqual(d.nome, off) || areNamesEqual(d.nome, u));
        return found ? found.nome : (off || u);
      }).filter(Boolean);
      setEditUtentiDaAbilitare(normalizedUtenti);

      setEditSGQ(p0.sgq || 'NO');
      setEditVerificatori(Array.isArray(p0.verificatori) ? p0.verificatori : []);
      setEditCompilatore(p0.compilatore || '');
      setEditGiornateSenior(p0.giornateSenior || 0);
      setEditGiornateProject(p0.giornateProject || 0);
      setEditGiornateJunior(p0.giornateJunior || 0);
    } else {
      setEditProgettiDescrizioni(['FORMAZIONE - Attività formative sulla commessa']);
      setEditUtentiDaAbilitare([]);
      setEditSGQ('NO');
      setEditVerificatori([]);
      setEditCompilatore('');
      setEditGiornateSenior(c.giornateSeniorProject || 0);
      setEditGiornateProject(c.giornateProject || 0);
      setEditGiornateJunior(c.giornateJuniorProject || 0);
    }
  };

  const handleSaveEditCommessa = async () => {
    if (!editingCommessa) return;
    if (!editTitolo.trim()) {
      showToast("Il titolo della commessa non può essere vuoto.", "error");
      return;
    }

    const cod = editingCommessa.codiceCommessa || (editingCommessa.nome ? editingCommessa.nome.split(' - ')[0] : '');
    const newNome = cod ? `${cod} - ${editTitolo.trim()}` : editTitolo.trim();
    const calculatedColor = TIPOLOGIA_COLORS[editTipologia] || editingCommessa.colore || '#64748b';

    const finalProgetti: CommessaProgetto[] = editProgettiDescrizioni
      .filter(desc => desc && desc.trim().length > 0)
      .map(desc => ({
        descrizione: desc.trim(),
        pm: editPM,
        utentiDaAbilitare: editUtentiDaAbilitare,
        sgq: editSGQ,
        verificatori: editVerificatori,
        compilatore: editCompilatore,
        giornateSenior: editSGQ === 'NO' ? editGiornateSenior : 0,
        giornateProject: editSGQ === 'NO' ? editGiornateProject : 0,
        giornateJunior: editSGQ === 'NO' ? editGiornateJunior : 0
      }));

    const totalSeniorDays = editSGQ === 'NO' ? (Number(editGiornateSenior) || 0) * finalProgetti.length : 0;
    const totalProjectDays = editSGQ === 'NO' ? (Number(editGiornateProject) || 0) * finalProgetti.length : 0;
    const totalJuniorDays = editSGQ === 'NO' ? (Number(editGiornateJunior) || 0) * finalProgetti.length : 0;
    const pmsUnivoci = editPM ? [editPM] : [];

    try {
      const docRef = doc(db, 'catalogo_commesse', editingCommessa.id);
      const updatedPayload = {
        nome: newNome,
        titolo: editTitolo.trim(),
        cliente: editCliente,
        anno: editAnno,
        tipologia: editTipologia,
        stato: editStato,
        colore: calculatedColor,
        dataInizio: editDataInizio || '',
        dataFine: editDataFine || '',
        responsabile: editResponsabile || '',
        pm: pmsUnivoci,
        giornateSeniorProject: totalSeniorDays,
        giornateProject: totalProjectDays,
        giornateJuniorProject: totalJuniorDays,
        progetti: finalProgetti
      };

      await setDoc(docRef, updatedPayload, { merge: true });

      showToast("Commessa aggiornata con successo nel catalogo!", "success");
      setEditingCommessa(null);
      await refreshData();
    } catch (err) {
      console.error("Errore durante l'aggiornamento della commessa:", err);
      showToast("Si è verificato un errore durante l'aggiornamento della commessa.", "error");
    }
  };

  const selectableTipologieCatalogo = useMemo(() => {
    const set = new Set<string>();
    Object.keys(TIPOLOGIE_COMMESSE).forEach(k => set.add(k));
    commesseGestibili.forEach(c => {
      const tipCode = getCommessaTipologiaCode(c);
      if (tipCode) set.add(tipCode);
    });
    return Array.from(set).sort();
  }, [commesseGestibili]);

  const filteredAndSortedCatalogoCommesse = useMemo(() => {
    let list = commesseGestibili.filter(c => {
      const cStato = (c as any).stato || 'Aperta';

      // 1. Filtro di Default per Stato (Default: Aperta)
      if (catalogoStatoFilter === 'Aperta' && cStato !== 'Aperta') return false;
      if (catalogoStatoFilter === 'Chiusa' && cStato !== 'Chiusa') return false;

      // 2. Ricerca Testuale
      const queryStr = searchCommessaQuery.toLowerCase();
      const codice = ((c as any).codiceCommessa || (c.nome ? c.nome.split(' - ')[0] : '') || '').toLowerCase();
      const titolo = ((c as any).titolo || c.nome || '').toLowerCase();
      const cliente = ((c as any).cliente || '').toLowerCase();
      const resp = (getOfficialName(c.responsabile) || '').toLowerCase();
      const pmArray = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
      const pmStr = pmArray.map(p => getOfficialName(p)).join(', ').toLowerCase();

      if (queryStr && !codice.includes(queryStr) && !titolo.includes(queryStr) && !cliente.includes(queryStr) && !resp.includes(queryStr) && !pmStr.includes(queryStr) && !c.nome.toLowerCase().includes(queryStr)) {
        return false;
      }

      // 3. Filtro Responsabile
      if (catalogoRespFilter) {
        const cResp = getOfficialName(c.responsabile) || '';
        if (!areNamesEqual(cResp, catalogoRespFilter)) return false;
      }

      // 4. Filtro PM
      if (catalogoPMFilter) {
        const pmList = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
        if (!pmList.some(p => areNamesEqual(getOfficialName(p), catalogoPMFilter))) return false;
      }

      // 5. Filtro Cliente
      if (catalogoClienteFilter) {
        const cCli = (c as any).cliente || '';
        if (cCli.trim().toLowerCase() !== catalogoClienteFilter.trim().toLowerCase()) return false;
      }

      // 6. Filtro Anno
      if (catalogoAnnoFilter) {
        const cAnno = getParsedField(c, 'anno');
        if (cAnno !== catalogoAnnoFilter) return false;
      }

      // 7. Filtro Tipologia
      if (catalogoTipologiaFilter) {
        const cTip = getParsedField(c, 'tipologia');
        if (cTip !== catalogoTipologiaFilter) return false;
      }

      return true;
    });

    // Ordinamento Cronologico o Alfabetico
    list.sort((a, b) => {
      let valA = '';
      let valB = '';

      if (catalogoSortBy === 'codice') {
        valA = (a as any).codiceCommessa || a.nome || '';
        valB = (b as any).codiceCommessa || b.nome || '';
      } else if (catalogoSortBy === 'anno') {
        valA = getParsedField(a, 'anno');
        valB = getParsedField(b, 'anno');
      } else if (catalogoSortBy === 'tipologia') {
        valA = getCommessaTipologiaCode(a);
        valB = getCommessaTipologiaCode(b);
      } else if (catalogoSortBy === 'titolo') {
        valA = (a as any).titolo || a.nome || '';
        valB = (b as any).titolo || b.nome || '';
      } else if (catalogoSortBy === 'cliente') {
        valA = (a as any).cliente || '';
        valB = (b as any).cliente || '';
      } else if (catalogoSortBy === 'stato') {
        valA = (a as any).stato || 'Aperta';
        valB = (b as any).stato || 'Aperta';
      } else if (catalogoSortBy === 'responsabile') {
        valA = getOfficialName(a.responsabile) || '';
        valB = getOfficialName(b.responsabile) || '';
      } else if (catalogoSortBy === 'pm') {
        const pmArrayA = Array.isArray(a.pm) ? a.pm : (a.pm ? [a.pm] : []);
        const pmArrayB = Array.isArray(b.pm) ? b.pm : (b.pm ? [b.pm] : []);
        valA = pmArrayA.map(p => getOfficialName(p)).join(', ');
        valB = pmArrayB.map(p => getOfficialName(p)).join(', ');
      } else if (catalogoSortBy === 'dataApertura') {
        valA = (a as any).dataApertura || '';
        valB = (b as any).dataApertura || '';
      }

      const cmp = valA.localeCompare(valB, 'it', { numeric: true, sensitivity: 'base' });
      return catalogoSortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [
    commesseGestibili,
    catalogoStatoFilter,
    searchCommessaQuery,
    catalogoRespFilter,
    catalogoPMFilter,
    catalogoClienteFilter,
    catalogoAnnoFilter,
    catalogoTipologiaFilter,
    catalogoSortBy,
    catalogoSortDir
  ]);

  const handleColumnHeaderSort = (field: 'codice' | 'anno' | 'tipologia' | 'titolo' | 'cliente' | 'stato' | 'responsabile' | 'pm' | 'dataApertura') => {
    if (catalogoSortBy === field) {
      setCatalogoSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setCatalogoSortBy(field);
      setCatalogoSortDir('asc');
    }
  };

  const hasActiveCatalogoFilters = useMemo(() => {
    return Boolean(
      searchCommessaQuery ||
      catalogoRespFilter ||
      catalogoPMFilter ||
      catalogoClienteFilter ||
      catalogoAnnoFilter ||
      catalogoTipologiaFilter ||
      catalogoStatoFilter !== 'Aperta'
    );
  }, [
    searchCommessaQuery,
    catalogoRespFilter,
    catalogoPMFilter,
    catalogoClienteFilter,
    catalogoAnnoFilter,
    catalogoTipologiaFilter,
    catalogoStatoFilter
  ]);

  const resetCatalogoFilters = () => {
    setSearchCommessaQuery('');
    setCatalogoStatoFilter('Aperta');
    setCatalogoRespFilter('');
    setCatalogoPMFilter('');
    setCatalogoClienteFilter('');
    setCatalogoAnnoFilter('');
    setCatalogoTipologiaFilter('');
    setCatalogoSortBy('codice');
    setCatalogoSortDir('asc');
  };

  const getCommessaPmsAndRespEmails = (commData: any): string[] => {
    const emails: string[] = [];
    if (commData.responsabile) {
      const respDip = dipendenti.find(d => areNamesEqual(d.nome, commData.responsabile));
      if (respDip?.email) emails.push(respDip.email.toLowerCase().trim());
    }
    const pms: string[] = Array.isArray(commData.pm) ? [...commData.pm] : (commData.pm ? [commData.pm] : []);
    if (Array.isArray(commData.progetti)) {
      commData.progetti.forEach((p: any) => {
        if (p.pm && !pms.includes(p.pm)) pms.push(p.pm);
      });
    }
    pms.forEach((pmName: string) => {
      const pmDip = dipendenti.find(d => areNamesEqual(d.nome, pmName));
      if (pmDip?.email) emails.push(pmDip.email.toLowerCase().trim());
    });
    return Array.from(new Set(emails.filter(Boolean)));
  };

  const generateCommessaAperturaEmailContent = (commData: any, openedByText?: string) => {
    const cod = commData.codiceCommessa || (commData.nome ? commData.nome.split(' - ')[0] : 'COMMESSA');
    const title = commData.titolo || (commData.nome && commData.nome.includes(' - ') ? commData.nome.split(' - ').slice(1).join(' - ') : commData.nome) || 'Commessa';
    const client = commData.cliente || 'Non specificato';
    const dataAperturaStr = commData.dataApertura 
      ? new Date(commData.dataApertura).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : new Date().toLocaleDateString('it-IT');
    const dataInizioStr = commData.dataInizio ? new Date(commData.dataInizio).toLocaleDateString('it-IT') : 'Non specificata';
    const dataFineStr = commData.dataFine ? new Date(commData.dataFine).toLocaleDateString('it-IT') : 'Non specificata';
    const respStr = commData.responsabile ? getOfficialName(commData.responsabile) : 'Non assegnato';
    const tipologiaStr = TIPOLOGIE_COMMESSE[commData.tipologia] || commData.tipologia || 'Standard';
    const userOpened = openedByText || commData.apertaDa || (myAssociatedName ? `${myAssociatedName} (${userEmail})` : userEmail);

    const progettiList: CommessaProgetto[] = Array.isArray(commData.progetti) && commData.progetti.length > 0
      ? commData.progetti
      : [{ descrizione: title }];

    // Dettagli condivisi generali
    const p0 = progettiList[0] || {};
    const pmStr = p0.pm ? getOfficialName(p0.pm) : (Array.isArray(commData.pm) ? commData.pm.map((p: string) => getOfficialName(p)).join(', ') : (commData.pm ? getOfficialName(commData.pm) : 'Non assegnato'));
    
    const utentiAbilitatiArr = Array.isArray(p0.utentiDaAbilitare) && p0.utentiDaAbilitare.length > 0
      ? p0.utentiDaAbilitare
      : (Array.isArray((commData as any).utentiAbilitati) ? (commData as any).utentiAbilitati : []);
    const utentiStr = utentiAbilitatiArr.length > 0
      ? utentiAbilitatiArr.map((u: string) => getOfficialName(u)).join(', ')
      : 'Tutti gli utenti abilitati di commessa';

    let sgqDetailsStr = '';
    if (p0.sgq === 'SI') {
      const vList = Array.isArray(p0.verificatori) ? p0.verificatori.map((v: string) => getOfficialName(v)).join(', ') : (p0.verificatori || '-');
      sgqDetailsStr = `✓ SGQ ABILITATO (Validatori: ${vList || '-'} | Compilatore: ${p0.compilatore ? getOfficialName(p0.compilatore) : '-'})`;
    } else {
      const sDays = p0.giornateSenior ?? commData.giornateSeniorProject ?? 0;
      const pDays = p0.giornateProject ?? commData.giornateProject ?? 0;
      const jDays = p0.giornateJunior ?? commData.giornateJuniorProject ?? 0;
      sgqDetailsStr = `SGQ non abilitato (Giornate Stimate: Senior: ${sDays} gg | Project: ${pDays} gg | Junior: ${jDays} gg)`;
    }

    let progettiListHtml = '';
    progettiList.forEach((p, idx) => {
      progettiListHtml += `<li style="margin-bottom: 6px; font-family: Arial, Helvetica, sans-serif;">${p.descrizione || `Progetto #${idx + 1}`}</li>`;
    });

    const mailSubject = `[Apertura Commessa] ${cod} - ${title}`;
    const mailHtmlBody = `
      <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#0f172a" style="width: 100%; background-color: #0f172a; border-collapse: collapse;">
        <tr>
          <td bgcolor="#0f172a" style="background-color: #0f172a; padding: 22px 24px; color: #ffffff; font-family: Arial, Helvetica, sans-serif;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width: 100%; border-collapse: collapse;">
              <tr>
                <td valign="top" align="left" style="font-family: Arial, Helvetica, sans-serif;">
                  <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px; color: #93c5fd; font-family: Arial, Helvetica, sans-serif;">
                    Scheda Apertura Nuova Commessa
                  </p>
                  <h1 style="margin: 0; font-size: 20px; font-weight: bold; color: #ffffff; line-height: 1.3; font-family: Arial, Helvetica, sans-serif;">
                    ${cod} — ${title}
                  </h1>
                  <p style="margin: 8px 0 0 0; font-size: 13px; color: #e2e8f0; font-weight: normal; font-family: Arial, Helvetica, sans-serif;">
                    Cliente: <strong style="color: #ffffff;">${client}</strong>
                  </p>
                </td>
                <td align="right" valign="top" width="100" style="text-align: right; vertical-align: top; width: 100px;">
                  <table border="0" cellspacing="0" cellpadding="0" align="right" style="border-collapse: collapse;">
                    <tr>
                      <td bgcolor="#10b981" align="center" style="background-color: #10b981; color: #ffffff; padding: 6px 14px; border-radius: 14px; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, Helvetica, sans-serif;">
                        APERTA
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; background-color: #ffffff;">
        <tr>
          <td style="padding: 22px 24px; font-family: Arial, Helvetica, sans-serif; color: #1e293b;">
            
            <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 18px; line-height: 1.5; font-family: Arial, Helvetica, sans-serif;">
              Notifica di apertura nuova commessa sulla piattaforma di pianificazione aziendale con i seguenti dettagli:
            </p>

            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 12px; border-collapse: collapse;">
              <tr>
                <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #1e1b4b; border-bottom: 2px solid #6366f1; padding-bottom: 6px;">
                  Anagrafica Generale & Impostazioni Commessa
                </td>
              </tr>
            </table>

            <table width="100%" border="0" cellpadding="8" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; margin-bottom: 22px; background-color: #ffffff; border: 1px solid #e2e8f0; font-family: Arial, Helvetica, sans-serif;">
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td width="200" bgcolor="#f8fafc" style="font-weight: bold; width: 200px; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Codice Commessa:</td>
                <td style="font-weight: bold; color: #0f172a; font-size: 13px; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">${cod}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Titolo Commessa:</td>
                <td style="font-weight: bold; color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">${title}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Cliente:</td>
                <td style="font-weight: bold; color: #1d4ed8; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">${client}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Data Apertura Registrata:</td>
                <td style="font-weight: bold; color: #047857; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">${dataAperturaStr}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Anno di Riferimento:</td>
                <td style="color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">${commData.anno || 'N/D'}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Tipologia Commessa:</td>
                <td style="color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">${tipologiaStr}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Periodo di Esecuzione:</td>
                <td style="color: #334155; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">Da: <strong>${dataInizioStr}</strong> a: <strong>${dataFineStr}</strong></td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Responsabile Commessa:</td>
                <td style="font-weight: bold; color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">${respStr}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Project Manager (PM):</td>
                <td style="font-weight: bold; color: #312e81; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">${pmStr}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Utenti Abilitati sulla Commessa:</td>
                <td style="font-weight: bold; color: #047857; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">${utentiStr}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Gestione SGQ / Giornate Stimate:</td>
                <td style="color: #334155; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">${sgqDetailsStr}</td>
              </tr>
              <tr>
                <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px;">Registrata / Aperta Da:</td>
                <td style="color: #475569; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif;">${userOpened}</td>
              </tr>
            </table>

            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 12px; border-collapse: collapse;">
              <tr>
                <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #1e1b4b; border-bottom: 2px solid #6366f1; padding-bottom: 6px;">
                  Elenco Progetti della Commessa (${progettiList.length})
                </td>
              </tr>
            </table>

            <table width="100%" border="0" cellpadding="14" cellspacing="0" style="width: 100%; border-collapse: collapse; background-color: #ffffff; border: 1px solid #cbd5e1; font-family: Arial, Helvetica, sans-serif; margin-bottom: 8px;">
              <tr>
                <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #0f172a; line-height: 1.6; padding: 14px;">
                  <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #0f172a; line-height: 1.7; font-family: Arial, Helvetica, sans-serif;">
                    ${progettiListHtml}
                  </ul>
                </td>
              </tr>
            </table>

          </td>
        </tr>
      </table>
    `;

    return { subject: mailSubject, htmlBody: mailHtmlBody };
  };

  const handleReinvioMailApertura = async (commToResend: any) => {
    if (!commToResend) return;
    try {
      const { subject, htmlBody } = generateCommessaAperturaEmailContent(commToResend);
      const baseRecipients = await getCommesseNotificationEmails();
      const roleRecipients = getCommessaPmsAndRespEmails(commToResend);
      const allRecipients = Array.from(new Set([...baseRecipients, ...roleRecipients]));
      for (const rec of allRecipients) {
        await queueMail(rec, subject, htmlBody, undefined, { isSystemNotification: true });
      }
      showToast("E-mail di apertura commessa re-inviata con successo!", "success");
    } catch (err) {
      console.error("Errore durante il re-invio dell'e-mail di apertura:", err);
      showToast("Si è verificato un errore durante il re-invio dell'e-mail.", "error");
    }
  };

  const generateCommessaChiusuraEmailContent = (commData: any, closedByText?: string) => {
    const cod = commData.codiceCommessa || (commData.nome ? commData.nome.split(' - ')[0] : 'COMMESSA');
    const title = commData.titolo || (commData.nome && commData.nome.includes(' - ') ? commData.nome.split(' - ').slice(1).join(' - ') : commData.nome) || 'Commessa';
    const client = commData.cliente || 'Non specificato';
    const dataChiusuraStr = commData.dataChiusura 
      ? new Date(commData.dataChiusura).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const dataInizioStr = commData.dataInizio ? new Date(commData.dataInizio).toLocaleDateString('it-IT') : 'Non specificata';
    const dataFineStr = commData.dataFine ? new Date(commData.dataFine).toLocaleDateString('it-IT') : 'Non specificata';
    const respStr = commData.responsabile ? getOfficialName(commData.responsabile) : 'Non assegnato';
    const tipologiaStr = TIPOLOGIE_COMMESSE[commData.tipologia] || commData.tipologia || 'Standard';
    const userClosed = closedByText || commData.chiusaDa || (myAssociatedName ? `${myAssociatedName} (${userEmail})` : userEmail);

    const progettiList: CommessaProgetto[] = Array.isArray(commData.progetti) && commData.progetti.length > 0
      ? commData.progetti
      : [{ descrizione: title }];

    const p0 = progettiList[0] || {};
    const pmStr = p0.pm ? getOfficialName(p0.pm) : (Array.isArray(commData.pm) ? commData.pm.map((p: string) => getOfficialName(p)).join(', ') : (commData.pm ? getOfficialName(commData.pm) : 'Non assegnato'));
    
    const utentiAbilitatiArr = Array.isArray(p0.utentiDaAbilitare) && p0.utentiDaAbilitare.length > 0
      ? p0.utentiDaAbilitare
      : (Array.isArray((commData as any).utentiAbilitati) ? (commData as any).utentiAbilitati : []);
    const utentiStr = utentiAbilitatiArr.length > 0
      ? utentiAbilitatiArr.map((u: string) => getOfficialName(u)).join(', ')
      : 'Tutti gli utenti abilitati di commessa';

    let sgqDetailsStr = '';
    if (p0.sgq === 'SI') {
      const vList = Array.isArray(p0.verificatori) ? p0.verificatori.map((v: string) => getOfficialName(v)).join(', ') : (p0.verificatori || '-');
      sgqDetailsStr = `✓ SGQ ABILITATO (Validatori: ${vList || '-'} | Compilatore: ${p0.compilatore ? getOfficialName(p0.compilatore) : '-'})`;
    } else {
      const sDays = p0.giornateSenior ?? commData.giornateSeniorProject ?? 0;
      const pDays = p0.giornateProject ?? commData.giornateProject ?? 0;
      const jDays = p0.giornateJunior ?? commData.giornateJuniorProject ?? 0;
      sgqDetailsStr = `SGQ non abilitato (Giornate Stimate: Senior: ${sDays} gg | Project: ${pDays} gg | Junior: ${jDays} gg)`;
    }

    let progettiListHtml = '';
    progettiList.forEach((p, idx) => {
      progettiListHtml += `<li style="margin-bottom: 6px; font-family: Arial, Helvetica, sans-serif;">${p.descrizione || `Progetto #${idx + 1}`}</li>`;
    });

    const mailSubject = `[Chiusura Commessa] ${cod} - ${title}`;
    const mailHtmlBody = `
      <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#0f172a" style="width: 100%; background-color: #0f172a; border-collapse: collapse;">
        <tr>
          <td bgcolor="#0f172a" style="background-color: #0f172a; padding: 22px 24px; color: #ffffff; font-family: Arial, Helvetica, sans-serif;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width: 100%; border-collapse: collapse;">
              <tr>
                <td valign="top" align="left" style="font-family: Arial, Helvetica, sans-serif;">
                  <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px; color: #fecdd3; font-family: Arial, Helvetica, sans-serif;">
                    Scheda Chiusura Commessa
                  </p>
                  <h1 style="margin: 0; font-size: 20px; font-weight: bold; color: #ffffff; line-height: 1.3; font-family: Arial, Helvetica, sans-serif;">
                    ${cod} — ${title}
                  </h1>
                  <p style="margin: 8px 0 0 0; font-size: 13px; color: #ffe4e6; font-weight: normal; font-family: Arial, Helvetica, sans-serif;">
                    Cliente: <strong style="color: #ffffff;">${client}</strong>
                  </p>
                </td>
                <td align="right" valign="top" width="100" style="text-align: right; vertical-align: top; width: 100px;">
                  <table border="0" cellspacing="0" cellpadding="0" align="right" style="border-collapse: collapse;">
                    <tr>
                      <td bgcolor="#e11d48" align="center" style="background-color: #e11d48; color: #ffffff; padding: 6px 14px; border-radius: 14px; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, Helvetica, sans-serif;">
                        CHIUSA
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; background-color: #ffffff;">
        <tr>
          <td style="padding: 22px 24px; font-family: Arial, Helvetica, sans-serif; color: #1e293b;">
            
            <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 18px; line-height: 1.5; font-family: Arial, Helvetica, sans-serif;">
              Notifica di avvenuta chiusura della commessa sulla piattaforma di pianificazione aziendale con i seguenti dettagli:
            </p>

            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 12px; border-collapse: collapse;">
              <tr>
                <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #881337; border-bottom: 2px solid #f43f5e; padding-bottom: 6px;">
                  Anagrafica Generale & Impostazioni Commessa
                </td>
              </tr>
            </table>

            <table width="100%" border="0" cellpadding="8" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; margin-bottom: 22px; background-color: #ffffff; border: 1px solid #fecdd3; font-family: Arial, Helvetica, sans-serif;">
              <tr style="border-bottom: 1px solid #fecdd3;">
                <td width="200" bgcolor="#fff1f2" style="font-weight: bold; width: 200px; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Codice Commessa:</td>
                <td style="font-weight: bold; color: #0f172a; font-size: 13px; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">${cod}</td>
              </tr>
              <tr style="border-bottom: 1px solid #fecdd3;">
                <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Titolo Commessa:</td>
                <td style="font-weight: bold; color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">${title}</td>
              </tr>
              <tr style="border-bottom: 1px solid #fecdd3;">
                <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Cliente:</td>
                <td style="font-weight: bold; color: #1d4ed8; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">${client}</td>
              </tr>
              <tr style="border-bottom: 1px solid #fecdd3;">
                <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Data Chiusura Registrata:</td>
                <td style="font-weight: bold; color: #be123c; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">${dataChiusuraStr}</td>
              </tr>
              <tr style="border-bottom: 1px solid #fecdd3;">
                <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Anno di Riferimento:</td>
                <td style="color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">${commData.anno || 'N/D'}</td>
              </tr>
              <tr style="border-bottom: 1px solid #fecdd3;">
                <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Tipologia Commessa:</td>
                <td style="color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">${tipologiaStr}</td>
              </tr>
              <tr style="border-bottom: 1px solid #fecdd3;">
                <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Da: <strong>${dataInizioStr}</strong> a: <strong>${dataFineStr}</strong></td>
              </tr>
              <tr style="border-bottom: 1px solid #fecdd3;">
                <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Responsabile Commessa:</td>
                <td style="font-weight: bold; color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">${respStr}</td>
              </tr>
              <tr style="border-bottom: 1px solid #fecdd3;">
                <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Project Manager (PM):</td>
                <td style="font-weight: bold; color: #312e81; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">${pmStr}</td>
              </tr>
              <tr style="border-bottom: 1px solid #fecdd3;">
                <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Utenti Abilitati sulla Commessa:</td>
                <td style="font-weight: bold; color: #047857; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">${utentiStr}</td>
              </tr>
              <tr style="border-bottom: 1px solid #fecdd3;">
                <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Gestione SGQ / Giornate Stimate:</td>
                <td style="color: #334155; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">${sgqDetailsStr}</td>
              </tr>
              <tr>
                <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px;">Registrata / Chiusa Da:</td>
                <td style="color: #be123c; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif;">${userClosed}</td>
              </tr>
            </table>

            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 12px; border-collapse: collapse;">
              <tr>
                <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #881337; border-bottom: 2px solid #f43f5e; padding-bottom: 6px;">
                  Elenco Progetti della Commessa
                </td>
              </tr>
            </table>

            <table width="100%" border="0" cellpadding="14" cellspacing="0" style="width: 100%; border-collapse: collapse; background-color: #ffffff; border: 1px solid #fecdd3; font-family: Arial, Helvetica, sans-serif; margin-bottom: 16px;">
              <tr>
                <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #0f172a; line-height: 1.6; padding: 14px;">
                  <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #0f172a; line-height: 1.7; font-family: Arial, Helvetica, sans-serif;">
                    ${progettiListHtml}
                  </ul>
                </td>
              </tr>
            </table>

            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
              <tr>
                <td style="padding: 12px 14px; background-color: #fef2f2; border: 1px solid #fecdd3; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #9f1239;">
                  Nota: Le eventuali assegnazioni di ore pianificate per questa commessa nelle settimane successive alla chiusura sono state automaticamente rimosse.
                </td>
              </tr>
            </table>

          </td>
        </tr>
      </table>
    `;

    return { subject: mailSubject, htmlBody: mailHtmlBody };
  };

  const handleReinvioMailChiusura = async (commToResend: any) => {
    if (!commToResend) return;
    try {
      const { subject, htmlBody } = generateCommessaChiusuraEmailContent(commToResend);
      const recipients = await getCommesseNotificationEmails();
      for (const rec of recipients) {
        await queueMail(rec, subject, htmlBody, undefined, { isSystemNotification: true });
      }
      showToast("E-mail di chiusura commessa re-inviata con successo!", "success");
    } catch (err) {
      console.error("Errore durante il re-invio dell'e-mail di chiusura:", err);
      showToast("Si è verificato un errore durante il re-invio dell'e-mail.", "error");
    }
  };

  const handleAddCommessa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !newCommessaTitolo) {
      showToast("Seleziona un cliente e inserisci il titolo della commessa.", "warning");
      return;
    }
    
    if (newCommessaDataInizio && newCommessaDataFine && newCommessaDataInizio > newCommessaDataFine) {
      showToast("La data di inizio non può essere successiva alla data di fine.", "warning");
      return;
    }

    const paddedClientCode = selectedClient.codice.padStart(4, '0');
    const codiceCommessa = `${newCommessaTipologia}${newCommessaAnno.slice(-2)}${paddedClientCode}${newCommessaLettera}`;
    
    if (commesse.some(c => c.codiceCommessa === codiceCommessa)) {
      showToast(`Errore: Esiste già una commessa con il codice "${codiceCommessa}". Modifica il progressivo.`, "error");
      return;
    }

    const calculatedColor = TIPOLOGIA_COLORS[newCommessaTipologia] || '#64748b';
    const dataAperturaIso = new Date().toISOString();

    // Costruzione dell'array dei progetti associando le descrizioni alle impostazioni comuni della commessa
    const finalProgetti: CommessaProgetto[] = newCommessaProgettiDescrizioni
      .filter(desc => desc && desc.trim().length > 0)
      .map(desc => ({
        descrizione: desc.trim(),
        pm: newCommessaPM,
        utentiDaAbilitare: newCommessaUtentiDaAbilitare,
        sgq: newCommessaSGQ,
        verificatori: newCommessaVerificatori,
        compilatore: newCommessaCompilatore,
        giornateSenior: newCommessaSGQ === 'NO' ? newCommessaGiornateSenior : 0,
        giornateProject: newCommessaSGQ === 'NO' ? newCommessaGiornateProject : 0,
        giornateJunior: newCommessaSGQ === 'NO' ? newCommessaGiornateJunior : 0
      }));

    // Calcolo totali giornate e elenco PM univoci
    const totalSeniorDays = newCommessaSGQ === 'NO' ? (Number(newCommessaGiornateSenior) || 0) * finalProgetti.length : 0;
    const totalProjectDays = newCommessaSGQ === 'NO' ? (Number(newCommessaGiornateProject) || 0) * finalProgetti.length : 0;
    const totalJuniorDays = newCommessaSGQ === 'NO' ? (Number(newCommessaGiornateJunior) || 0) * finalProgetti.length : 0;
    const pmsUnivoci = newCommessaPM ? [newCommessaPM] : [];

    try {
      const payload = {
        nome: `${codiceCommessa} - ${newCommessaTitolo}`,
        codiceCommessa,
        anno: newCommessaAnno,
        tipologia: newCommessaTipologia,
        titolo: newCommessaTitolo,
        cliente: selectedClient.nome,
        stato: 'Aperta',
        colore: calculatedColor,
        dataApertura: dataAperturaIso,
        dataInizio: newCommessaDataInizio || '',
        dataFine: newCommessaDataFine || '',
        responsabile: newCommessaResponsabile || '',
        pm: pmsUnivoci,
        giornateSeniorProject: totalSeniorDays,
        giornateProject: totalProjectDays,
        giornateJuniorProject: totalJuniorDays,
        progetti: finalProgetti
      };
      
      await addDoc(collection(db, 'catalogo_commesse'), payload);
      
      // Invio notifica e-mail apertura commessa ai destinatari di sistema + PM e Responsabili
      const { subject: mailSubject, htmlBody: finalMailBody } = generateCommessaAperturaEmailContent(payload);

      const baseCreationRecipients = await getCommesseNotificationEmails();
      const roleCreationRecipients = getCommessaPmsAndRespEmails(payload);
      const allCreationRecipients = Array.from(new Set([...baseCreationRecipients, ...roleCreationRecipients]));
      for (const rec of allCreationRecipients) {
        await queueMail(rec, mailSubject, finalMailBody, undefined, { isSystemNotification: true });
      }
      
      setSelectedClient(null);
      setClientSearchText('');
      setNewCommessaTitolo('');
      setNewCommessaDataInizio('');
      setNewCommessaDataFine('');
      setNewCommessaLettera('A');
      setNewCommessaResponsabile('');
      setNewCommessaProgettiDescrizioni(['FORMAZIONE - Attività formative sulla commessa']);
      setNewCommessaPM('');
      setNewCommessaUtentiDaAbilitare([]);
      setNewCommessaSGQ('NO');
      setNewCommessaVerificatori([]);
      setNewCommessaCompilatore('');
      setNewCommessaGiornateSenior(0);
      setNewCommessaGiornateProject(0);
      setNewCommessaGiornateJunior(0);

      await refreshData();
      setActiveTab('consultazione');
      showToast("Nuova commessa registrata con successo nel catalogo!", "success");
    } catch (err) {
      console.error("Errore durante il salvataggio della nuova commessa:", err);
      showToast("Errore durante il salvataggio della nuova commessa.", "error");
    }
  };

  const handleRemoveCommessa = async (id: string, name: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Elimina Commessa',
      message: `Sei sicuro di voler eliminare la commessa "${name}" dal catalogo? Tutte le assegnazioni associate a questa commessa verranno rimosse a cascata da tutti i dipendenti.`,
      type: 'danger',
      onConfirm: async () => {
        try {
          // 1. Elimina la commessa dal catalogo
          await deleteDoc(doc(db, 'catalogo_commesse', id));
          
          // 2. Elimina a cascata le assegnazioni (solo sui documenti interessati identificati in memoria)
          for (const [docId, currentList] of Object.entries(assignments)) {
            if (!Array.isArray(currentList)) continue;
            if (!currentList.some((a: any) => a.commessaId === id)) continue;

            const updatedList = currentList.filter((a: any) => a.commessaId !== id);
            if (updatedList.length === 0) {
              await deleteDoc(doc(db, 'assegnazioni', docId));
            } else {
              await setDoc(doc(db, 'assegnazioni', docId), { lista: updatedList });
            }
          }

          await refreshData();
          showToast("Commessa e relative assegnazioni rimosse con successo!", "success");
        } catch (err) {
          console.error("Errore rimozione commessa:", err);
          showToast("Si è verificato un errore durante l'eliminazione.", "error");
        } finally {
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  const handlePrintCatalogoCommesse = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const commesseMapped = filteredAndSortedCatalogoCommesse.map(c => {
      const cod = (c as any).codiceCommessa || c.nome.split(' - ')[0] || '';
      const tit = (c as any).titolo || c.nome.split(' - ').slice(1).join(' - ') || c.nome;
      const cli = (c as any).cliente || '-';
      const sta = (c as any).stato || 'Aperta';
      return { ...c, cod, tit, cli, sta };
    });

    const commesseOrd = [...commesseMapped].sort((a, b) => b.cod.localeCompare(a.cod));

    const rowsHtml = commesseOrd.length === 0 ? `
      <tr>
        <td colspan="5" style="text-align: center; padding: 20px; color: #9ca3af; font-weight: 700;">
          Nessuna commessa censita.
        </td>
      </tr>
    ` : commesseOrd.map((c, idx) => {
      const rowBg = idx % 2 === 1 ? 'background-color: #f9fafb;' : 'background-color: #ffffff;';
      let statusColor = '#6b7280';
      if (c.sta === 'Aperta') statusColor = '#10b981';
      if (c.sta === 'Chiusa') statusColor = '#ef4444';
      if (c.sta === 'In Attesa') statusColor = '#f59e0b';
      if (c.sta === 'Sospesa') statusColor = '#6366f1';

      return `
        <tr style="${rowBg}">
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; text-align: center; font-weight: 800;">${idx + 1}</td>
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; font-weight: 800; color: #111827;">${c.cod}</td>
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; font-weight: 600; color: #374151;">${c.tit}</td>
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; font-weight: 600; color: #4b5563;">${c.cli}</td>
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; text-align: center; font-weight: 700; color: ${statusColor};">${c.sta}</td>
        </tr>
      `;
    }).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="it">
      <head>
        <meta charset="UTF-8">
        <title>Catalogo Commesse Aziendali</title>
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          * { box-sizing: border-box !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: #ffffff !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 9.5px; color: #111827; }
          
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
          
          table.report-table { width: 100% !important; border-collapse: collapse !important; border: 1.5px solid #4b5563 !important; font-size: 9px !important; }
          table.report-table th { background-color: #f3f4f6 !important; color: #111827 !important; font-size: 8.5px !important; font-weight: 800 !important; text-transform: uppercase !important; letter-spacing: 0.5px !important; padding: 4.5px 6px !important; border: 1px solid #6b7280 !important; }
          table.report-table td { padding: 4px 6px !important; border: 1px solid #d1d5db !important; vertical-align: middle !important; }
          table.report-table tr { page-break-inside: avoid !important; break-inside: avoid !important; }
          
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
                  <div class="header-title-right">INGEGNO P&C S.R.L. · CATALOGO COMMESSE</div>
                </div>
                <div class="title-banner">
                  <span class="title-banner-text">CATALOGO COMMESSE AZIENDALI</span>
                  <span class="count-badge">${commesseOrd.length} COMMESSE</span>
                </div>
              </td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div class="filter-box">
                  <span><strong>Data Stampa:</strong> ${getPrintDateString()}</span>
                  <span><strong>Totale Commesse Censite:</strong> ${commesseOrd.length}</span>
                </div>

                <table class="report-table">
                  <thead>
                    <tr>
                      <th style="width: 7%; text-align: center;">#</th>
                      <th style="width: 18%; text-align: left;">Codice Commessa</th>
                      <th style="width: 35%; text-align: left;">Descrizione Attività</th>
                      <th style="width: 25%; text-align: left;">Cliente</th>
                      <th style="width: 15%; text-align: center;">Stato Commessa</th>
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

  const handleExportCatalogoExcel = () => {
    const headers = ['Codice Commessa', 'Anno', 'Tipologia', 'Titolo', 'Cliente', 'Stato', 'Responsabile', 'PM', 'Data Inizio', 'Data Fine'];
    
    const rows = filteredAndSortedCatalogoCommesse.map(c => {
      const cod = (c as any).codiceCommessa || c.nome.split(' - ')[0] || '';
      const ann = c.anno || '';
      const tip = c.tipologia || '';
      const tit = (c as any).titolo || c.nome.split(' - ').slice(1).join(' - ') || c.nome;
      const cli = (c as any).cliente || '';
      const sta = (c as any).stato || 'Aperta';
      const resp = getOfficialName(c.responsabile) || '';
      const pmArray = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
      const pmStr = pmArray.map(p => getOfficialName(p)).join(', ');
      const dIni = c.dataInizio || '';
      const dFin = c.dataFine || '';

      return [cod, ann, tip, tit, cli, sta, resp, pmStr, dIni, dFin].map(val => {
        const cleanVal = String(val).replace(/"/g, '""');
        return `"${cleanVal}"`;
      }).join(';');
    });

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Catalogo_Commesse_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast("Esportazione Excel completata con successo!", "success");
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
          <div className="p-3 bg-blue-100 rounded-2xl"><Briefcase className="text-blue-600 w-8 h-8" /></div>
          <div className="flex items-center gap-3">
            <span>Pianificazione Avanzamento Commesse</span>
            <button 
              onClick={() => window.location.reload()}
              title="Aggiorna Dati"
              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-100 rounded-xl transition-all cursor-pointer hover:rotate-180 duration-500"
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
          </div>
        </h2>
      </div>
      
      {/* TAB BAR (Per Admin, Soci, Coordinatori, Sviluppatori e Responsabili) */}
      {(canAccessCatalogo || canAccessAltreCommesseTab) && (
        <div className="flex border-b border-gray-200 gap-2 no-print">
          <button
            type="button"
            onClick={() => setActiveTab('consultazione')}
            className={`px-5 py-3 font-bold text-sm rounded-t-2xl transition-all cursor-pointer ${
              activeTab === 'consultazione'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-200/50'
                : 'bg-gray-50 text-gray-650 hover:bg-gray-100'
            }`}
          >
            🗓️ Consultazione Commesse
          </button>

          {canAccessCatalogo && (
            <button
              type="button"
              onClick={() => setActiveTab('gestione')}
              className={`px-5 py-3 font-bold text-sm rounded-t-2xl transition-all cursor-pointer ${
                activeTab === 'gestione'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200/50'
                  : 'bg-gray-50 text-gray-650 hover:bg-gray-100'
              }`}
            >
              📁 Gestione Catalogo
            </button>
          )}

          {canAccessAltreCommesseTab && (
            <button
              type="button"
              onClick={() => setActiveTab('altre-commesse')}
              className={`px-5 py-3 font-bold text-sm rounded-t-2xl transition-all cursor-pointer ${
                activeTab === 'altre-commesse'
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-200/50'
                  : 'bg-gray-50 text-gray-650 hover:bg-gray-100'
              }`}
            >
              ✉️ Altre Commesse (Richiesta)
            </button>
          )}
        </div>
      )}

      {/* TAB 1: CONSULTAZIONE COMMESSE */}
      {activeTab === 'consultazione' && (
        <>
          {/* TIMELINE TABLE CARD */}
          <div className="bg-white rounded-[2rem] shadow-sm border border-gray-200 relative mb-10 flex flex-col overflow-hidden">
            
                        {/* TOOLBAR */}
            <div className="p-4 border-b border-gray-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4 no-print bg-gray-50/50 rounded-t-[2rem] shrink-0 py-4">
              <div className="flex flex-wrap items-center justify-between gap-4 w-full">
                
                {/* Filters and Zoom - Filtri Avanzati */}
                <div className="flex flex-wrap items-end gap-3 flex-1">
                  {/* Zoom Temporale */}
                  <div className="flex flex-col">
                    <label className="text-[10px] font-extrabold text-gray-455 uppercase tracking-wider ml-1 mb-1">Zoom</label>
                    <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-gray-200 shadow-sm h-[38px]">
                      <button 
                        type="button"
                        onClick={() => setZoomWeeks(prev => Math.max(2, prev - 2))} 
                        className="p-1 hover:bg-gray-100 rounded-lg text-gray-655 transition flex items-center justify-center cursor-pointer"
                        title="Zoom In"
                      >
                        <ZoomIn className="w-4 h-4 text-blue-600" />
                      </button>
                      <span className="text-xs font-bold text-gray-750 min-w-[45px] text-center select-none">{zoomWeeks} Sett.</span>
                      <button 
                        type="button"
                        onClick={() => setZoomWeeks(prev => Math.min(52, prev + 2))} 
                        className="p-1 hover:bg-gray-100 rounded-lg text-gray-655 transition flex items-center justify-center cursor-pointer"
                        title="Zoom Out"
                      >
                        <ZoomOut className="w-4 h-4 text-blue-600" />
                      </button>
                    </div>
                  </div>

                  {/* Filtro Cliente */}
                  <div className="flex flex-col">
                    <label className="text-[10px] font-extrabold text-gray-455 uppercase tracking-wider ml-1 mb-1">Cliente</label>
                    <select
                      value={selectedClientFilter}
                      onChange={e => setSelectedClientFilter(e.target.value)}
                      className="p-2 border bg-white rounded-xl font-bold text-gray-700 text-xs outline-none focus:ring-2 focus:ring-blue-400 w-44 shadow-sm cursor-pointer h-[38px]"
                    >
                      <option value="">Tutti i Clienti</option>
                      {selectableClientiPerFiltro.map(client => (
                        <option key={client} value={client}>{client}</option>
                      ))}
                    </select>
                  </div>

                  {/* Filtro Responsabile */}
                  <div className="flex flex-col">
                    <label className="text-[10px] font-extrabold text-gray-455 uppercase tracking-wider ml-1 mb-1">Responsabile</label>
                    <select
                      value={selectedPMFilter}
                      onChange={e => setSelectedPMFilter(e.target.value)}
                      className="p-2 border bg-white rounded-xl font-bold text-gray-700 text-xs outline-none focus:ring-2 focus:ring-blue-400 w-44 shadow-sm cursor-pointer h-[38px]"
                    >
                      <option value="">Tutti i Responsabili</option>
                      {selectablePMPerFiltro.map(pm => (
                        <option key={pm} value={pm}>{pm}</option>
                      ))}
                    </select>
                  </div>

                  {/* Filtro Commessa Multi-selezione */}
                  <div className="relative flex flex-col">
                    <label className="text-[10px] font-extrabold text-gray-455 uppercase tracking-wider ml-1 mb-1">Commesse</label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setIsCommessaDropdownOpen(!isCommessaDropdownOpen)}
                        className="p-2.5 border bg-white rounded-xl font-bold text-gray-700 text-xs text-left outline-none focus:ring-2 focus:ring-blue-400 w-52 shadow-sm flex justify-between items-center cursor-pointer h-[38px]"
                      >
                        <span className="truncate mr-4 text-gray-700">
                          {selectedCommessaIdsFilter.length === 0 
                            ? 'Tutte le Commesse' 
                            : `${selectedCommessaIdsFilter.length} Selezionate`}
                        </span>
                        <span className="text-gray-455 ml-auto shrink-0 text-[10px]">▼</span>
                      </button>
                      {selectedCommessaIdsFilter.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCommessaIdsFilter([]);
                            setCommessaTextQuery('');
                          }}
                          className="absolute right-8 top-1/2 -translate-y-1/2 text-red-500 hover:text-red-700 font-extrabold text-[10px] bg-red-50 px-2 py-1 rounded-lg transition"
                        >
                          Azzera
                        </button>
                      )}
                    </div>
                    {isCommessaDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => {
                          setIsCommessaDropdownOpen(false);
                          setCommessaTextQuery('');
                        }}></div>
                        <div className="absolute left-0 mt-12 w-80 max-h-80 bg-white border border-gray-150 rounded-2xl shadow-2xl z-50 p-3 flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
                          <div className="relative shrink-0">
                            <input
                              type="text"
                              placeholder="Cerca commessa..."
                              value={commessaTextQuery}
                              onChange={e => setCommessaTextQuery(e.target.value)}
                              className="w-full p-2 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50/50 text-gray-700"
                              autoFocus
                            />
                            {commessaTextQuery && (
                              <button
                                type="button"
                                onClick={() => setCommessaTextQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-650 text-xs font-black"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                          
                          <div className="flex justify-between items-center text-[10px] font-bold text-blue-600 border-b pb-1.5 shrink-0 px-1">
                            <button
                              type="button"
                              onClick={() => {
                                const filteredComms = commesse.filter(c => (c.stato || 'Aperta') !== 'Chiusa').filter(c => {
                                  const query = commessaTextQuery.toLowerCase().trim();
                                  if (!query) return true;
                                  return (c.nome || '').toLowerCase().includes(query) || (c.cliente || '').toLowerCase().includes(query);
                                });
                                setSelectedCommessaIdsFilter(filteredComms.map(c => c.id));
                              }}
                              className="hover:underline cursor-pointer"
                            >
                              Seleziona tutti filtrati
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCommessaIdsFilter([]);
                              }}
                              className="hover:underline text-red-655 cursor-pointer"
                            >
                              Deseleziona tutti
                            </button>
                          </div>

                          <div className="overflow-y-auto max-h-48 divide-y divide-gray-50 pr-1 scrollbar-thin">
                            {(() => {
                              const search = commessaTextQuery.toLowerCase().trim();
                              
                              let listToDisplay = commesse.filter(c => (c.stato || 'Aperta') !== 'Chiusa');
                              if (!isAdmin && !isSoci(myAssociatedName) && myAssociatedName) {
                                const assignedCommessaIds = new Set<string>();
                                Object.entries(assignments).forEach(([key, listAss]) => {
                                  const keyName = key.split('-')[0];
                                  if (areNamesEqual(keyName, myAssociatedName) || key.startsWith(`${myAssociatedName}-`)) {
                                    listAss.forEach(ass => {
                                      if (ass.percentuale > 0) {
                                        assignedCommessaIds.add(ass.commessaId);
                                      }
                                    });
                                  }
                                });
                                listToDisplay = commesse.filter(c => assignedCommessaIds.has(c.id) || isUserPmOrRespOfCommessa(c));
                              }

                              const filtered = listToDisplay.filter(c => {
                                const name = (c.nome || '').toLowerCase();
                                const client = (c.cliente || '').toLowerCase();
                                return name.includes(search) || client.includes(search);
                              }).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

                              if (filtered.length === 0) {
                                return <div className="p-3 text-xs text-gray-400 italic font-bold">Nessuna commessa trovata</div>;
                              }

                              return filtered.map(c => {
                                const isChecked = selectedCommessaIdsFilter.includes(c.id);
                                return (
                                  <label
                                    key={c.id}
                                    className="flex items-center gap-2.5 p-2 hover:bg-blue-50/50 text-xs font-semibold text-gray-700 transition-colors cursor-pointer rounded-lg select-none"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => toggleCommessaIdFilter(c.id)}
                                      className="rounded text-blue-600 focus:ring-blue-400 border-gray-300 w-3.5 h-3.5"
                                    />
                                    <span className="truncate" title={c.nome}>{c.nome}</span>
                                  </label>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Pulsante Azzera Tutti i Filtri */}
                  {(selectedClientFilter || selectedPMFilter || selectedCommessaIdsFilter.length > 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedClientFilter('');
                        setSelectedPMFilter('');
                        setSelectedTipologiaFilter('');
                        setSelectedCommessaIdsFilter([]);
                      }}
                      className="px-3 py-2 text-xs font-bold text-red-655 hover:text-red-705 bg-red-50 hover:bg-red-100 rounded-xl transition border border-red-100 shadow-sm shrink-0 h-[38px] active:scale-95 cursor-pointer"
                    >
                      Azzera Filtri
                    </button>
                  )}
                  
                  {/* Show timeline info */}
                  {selectedCommessaIdsFilter.length === 1 && (
                    <div className="flex flex-col justify-end h-[38px]">
                      <div className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-3.5 py-2 rounded-xl flex items-center gap-1.5 h-full">
                        <Calendar className="w-3.5 h-3.5" />
                        Arco temporale commessa attivo.
                      </div>
                    </div>
                  )}
                </div>

                {/* Navigation Controls */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm">
                    <button onClick={() => shiftPeriod(-zoomWeeks)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-655 transition cursor-pointer" title="Indietro"><ChevronLeft className="w-4 h-4" /></button>
                    <button onClick={resetToToday} className="px-3 py-1.5 text-xs font-extrabold text-gray-700 hover:bg-gray-100 rounded-lg transition cursor-pointer">Oggi</button>
                    <button onClick={() => shiftPeriod(zoomWeeks)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-655 transition cursor-pointer" title="Avanti"><ChevronRight className="w-4 h-4" /></button>
                    <div className="h-5 w-px bg-gray-200 mx-1"></div>
                    <input 
                      type="date" 
                      value={(baseDate && !isNaN(baseDate.getTime())) ? baseDate.toISOString().split('T')[0] : ''} 
                      onChange={e => {
                        if (e.target.value) {
                          const d = new Date(e.target.value);
                          if (!isNaN(d.getTime())) setBaseDate(d);
                        }
                      }} 
                      className="text-xs font-bold border-none bg-transparent outline-none text-gray-700 cursor-pointer pl-1 pr-1" 
                    />
                  </div>
                  
                  <button 
                    type="button"
                    onClick={() => setIsMyTasksModalOpen(true)} 
                    className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-md active:scale-95 cursor-pointer relative"
                    title="Riepilogo delle tue attività ToDo assegnate su tutte le commesse"
                  >
                    <ListTodo className="w-4 h-4 text-indigo-200" />
                    <span>I Miei ToDo</span>
                    {totalMyPendingTasksCount > 0 ? (
                      <span className="bg-rose-500 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full shadow-xs border border-white/40">
                        {totalMyPendingTasksCount}
                      </span>
                    ) : (
                      <span className="bg-emerald-500 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full shadow-xs border border-white/40">
                        0
                      </span>
                    )}
                  </button>

                  <button onClick={handleExportToExcel} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-md active:scale-95 cursor-pointer">
                    <Download className="w-4 h-4" /> Esporta Excel
                  </button>
                </div>
              </div>
            </div>

            {/* Load Grid Wrapper */}
            <div 
              ref={tableContainerRef}
              className="w-full overflow-auto scrollbar-thin"
              style={{ maxHeight: `${tableHeight}px` }}
            >
              <table 
                className="w-full text-left border-separate border-spacing-0 text-xs"
                style={{ minWidth: `${264 + activeWeeks.length * parseInt(weekColumnMinWidth)}px` }}
              >
                <thead className="sticky top-0 z-30 bg-white shadow-sm border-b-2 border-gray-200">
                  {/* Month Group Header Row */}
                  <tr className="bg-gray-50 border-b text-[11px] font-black text-gray-500 text-center uppercase tracking-wider" style={{ height: '40px', minHeight: '40px', maxHeight: '40px' }}>
                    <th 
                      className="p-0 text-center sticky left-0 top-0 z-35 bg-gray-50 shadow-[1px_0_0_0_#e5e7eb] font-black truncate whitespace-nowrap"
                      style={{ width: '264px', minWidth: '264px', maxWidth: '264px', height: '40px', minHeight: '40px', maxHeight: '40px', lineHeight: '40px' }}
                    >
                      Mesi
                    </th>
                    {monthSpans.map((span, idx) => (
                      <th key={idx} colSpan={span.colSpan} className="p-0 px-1 border-l border-gray-200 text-center bg-gray-50 font-black sticky top-0 z-30 truncate whitespace-nowrap overflow-hidden" style={{ height: '40px', minHeight: '40px', maxHeight: '40px', lineHeight: '40px' }}>
                        {span.label}
                      </th>
                    ))}
                  </tr>
                  {/* Week Header Row */}
                  <tr className="h-12">
                    <th 
                      className="p-4 font-extrabold text-gray-900 sticky left-0 z-35 bg-white shadow-[1px_0_0_0_#e5e7eb] h-12 truncate"
                      style={{ width: '264px', minWidth: '264px', maxWidth: '264px', top: '39px' }}
                    >
                      Commesse e Clienti
                    </th>
                    {activeWeeks.map((wk, i) => {
                      const isCurrentWeek = wk.id === `${new Date().getFullYear()}-W${getWeekNumber(new Date())}`;
                      return (
                        <th 
                          key={i} 
                          className={`${isUltraNarrow ? 'p-1' : isNarrow ? 'p-1.5' : 'p-3'} text-center border-l border-b border-gray-200 sticky z-30 bg-white h-12 ${isCurrentWeek ? 'bg-blue-50/50 ring-2 ring-inset ring-blue-200' : ''}`}
                          style={{ minWidth: weekColumnMinWidth, width: weekColumnMinWidth, top: '39px' }}
                        >
                          <div className="font-extrabold text-gray-900 text-xs truncate" title={wk.label}>
                            {isNarrow ? wk.label.replace('Sett. ', 'S') : wk.label}
                          </div>
                          {(() => {
                            const [d1, d2] = wk.sub.split(' - ');
                            return (
                              <div className="text-[9.5px] font-bold text-gray-400 mt-0.5 flex flex-col items-center leading-none select-none">
                                <span>{d1}</span>
                                <span className="text-[8px] my-0.5 opacity-60">↓</span>
                                <span>{d2}</span>
                              </div>
                            );
                          })()}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                
                                {filteredCommesse.length === 0 ? (
                  <tbody className="divide-y divide-gray-100 font-medium">
                    <tr>
                      <td colSpan={activeWeeks.length + 1} className="p-12 text-center text-gray-400 font-bold italic">
                        {!isAdmin ? "Non sei assegnato a nessuna commessa in questo periodo." : "Nessuna commessa trovata con i filtri selezionati."}
                      </td>
                    </tr>
                  </tbody>
                ) : (
                  <tbody className="divide-y divide-gray-105 font-medium bg-white">
                    {filteredCommesse.map(comm => {
                      return (
                        <tr key={comm.id} className="hover:bg-blue-50/20 transition-colors bg-white">
                          <td 
                            className="p-3 font-bold text-gray-800 bg-white sticky left-0 z-10 shadow-[1px_0_0_0_#f3f4f6] border-b align-middle text-left"
                            style={{ width: '264px', minWidth: '264px', maxWidth: '264px' }}
                          >
                            <div className="flex items-stretch gap-2.5">
                              <span className="w-3 h-3 rounded-full shadow-inner shrink-0 mt-1" style={{backgroundColor: (comm.tipologia && TIPOLOGIA_COLORS[comm.tipologia]) || comm.colore || '#64748b'}}></span>
                              
                              <div className="min-w-0 flex-1 text-left flex flex-col justify-between">
                                <div className="whitespace-normal break-words font-extrabold text-xs text-gray-800 leading-tight" title={comm.nome}>{comm.nome}</div>
                                
                                <div className="text-[10px] text-indigo-655 font-bold italic mt-1 truncate">
                                  💼 Cliente: {comm.cliente || 'Nessun cliente'}
                                </div>
                                {comm.dataInizio && comm.dataFine ? (
                                  <div className="text-[9.5px] text-gray-400 font-bold mt-0.5 truncate" title={`${formatDate(comm.dataInizio)} - ${formatDate(comm.dataFine)}`}>
                                    Periodo: {formatDate(comm.dataInizio)} - {formatDate(comm.dataFine)}
                                  </div>
                                ) : (
                                  <div className="text-[9.5px] text-orange-500 font-bold mt-0.5 truncate">
                                    Nessun periodo impostato
                                  </div>
                                )}
                                {(comm.responsabile || comm.pm) ? (
                                  <div className="text-[9px] text-gray-500 font-semibold mt-0.5 truncate" title={`${comm.responsabile ? `Resp: ${getOfficialName(comm.responsabile)}` : ''}${comm.pm ? ` | PM: ${formatPMField(comm.pm)}` : ''}`}>
                                    {comm.responsabile && `Resp: ${getOfficialName(comm.responsabile)}`} {comm.pm && ` | PM: ${formatPMField(comm.pm)}`}
                                  </div>
                                ) : (
                                  <div className="text-[9px] text-gray-455 font-medium mt-0.5 italic truncate">
                                    Resp/PM non assegnati
                                  </div>
                                )}
                              </div>

                              {(() => {
                                const pList: PunchListItem[] = comm.punchList || [];
                                const totalTasks = pList.length;
                                const completedTasks = pList.filter(t => t.stato === 'completato' || t.stato === 'eseguito').length;
                                const openTasks = pList.filter(t => t.stato === 'da_fare').length;

                                return (
                                  <div className="flex flex-col items-center justify-between shrink-0 bg-slate-50/95 py-2 px-1.5 rounded-2xl border border-slate-200/90 shadow-2xs self-stretch min-h-[96px] w-[36px]">
                                    {/* 1. In alto: Info */}
                                    <button 
                                      type="button"
                                      onClick={() => handleOpenInfoModal(comm)}
                                      className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50/80 rounded-xl transition-all shrink-0 cursor-pointer"
                                      title="Visualizza dettagli e specifiche commessa"
                                    >
                                      <Info className="w-4 h-4" />
                                    </button>

                                    {/* 2. Al centro: Cartella di Rete */}
                                    {comm.percorsoRete ? (
                                      <button
                                        type="button"
                                        onClick={(e) => handleOpenNetworkPath(comm, e)}
                                        className="w-7 h-7 flex items-center justify-center text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-xl transition-all cursor-pointer"
                                        title={`📁 Apri / Copia percorso di rete:\n${comm.percorsoRete}`}
                                      >
                                        <Folder className="w-4 h-4" />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedCommessaForNetworkPath(comm);
                                          setNetworkPathInput('');
                                          setIsNetworkPathModalOpen(true);
                                        }}
                                        className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-gray-100 rounded-xl transition-all cursor-pointer"
                                        title="Imposta percorso cartella di rete (UNC)"
                                      >
                                        <Folder className="w-4 h-4" />
                                      </button>
                                    )}

                                    {/* 3. In basso: Lista ToDo */}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedCommessaForPunchList(comm);
                                        setEditingTask(null);
                                        setNewTaskTitolo('');
                                        setNewTaskDescrizione('');
                                        setNewTaskScadenza('');
                                        setNewTaskAssegnatoA('');
                                        setNewTaskCategoria(TODO_CATEGORIE[0] || 'aggiornare');
                                        setIsPunchListModalOpen(true);
                                      }}
                                      className={`relative w-7 h-7 flex items-center justify-center rounded-xl transition-all cursor-pointer ${
                                        openTasks > 0
                                          ? 'text-indigo-600 hover:bg-indigo-100/70 font-black'
                                          : 'text-gray-400 hover:text-indigo-600 hover:bg-gray-100'
                                      }`}
                                      title={`📋 ToDo List (${completedTasks}/${totalTasks} completati)${openTasks > 0 ? ` - ${openTasks} da fare` : ''}`}
                                    >
                                      <ListTodo className="w-4 h-4" />
                                      {openTasks > 0 && (
                                        <span className="absolute -top-1 -right-1.5 text-[8.5px] font-black min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center text-white bg-indigo-600 shadow-xs border border-white">
                                          {openTasks}
                                        </span>
                                      )}
                                    </button>
                                  </div>
                                );
                              })()}
                            </div>
                          </td>
                          {activeWeeks.map((wk, wIndex) => {
                            const assignedPeople = getAssignmentsForCommessaInWeek(comm.id, wk.id);
                            const isCurrentWeek = wk.id === `${new Date().getFullYear()}-W${getWeekNumber(new Date())}`;
                            const commRange = commesseDateRangeMap.get(comm.id);
                            const wkRange = weeksRangeMap.get(wk.id);
                            const isWithinRange = !!(commRange && wkRange && wkRange.wkStartMs <= commRange.endMs && wkRange.wkEndMs >= commRange.startMs);
                            const commColor = (comm.tipologia && TIPOLOGIA_COLORS[comm.tipologia]) || comm.colore || '#3b82f6';
                            const cellBg = isWithinRange ? hexToRgba(commColor, 0.08) : undefined;
                            
                            const prioKey = `${comm.id}_${wk.id}`;
                            const weekPriority = prioritaCommesse[prioKey] || 'Standard';

                            let priorityBorderStyle = '';
                            let priorityTopBarColor = 'bg-indigo-150/40 group-hover/weekcell:bg-indigo-600';
                            let priorityTitle = `Pianificazione settimana (${comm.nome} - ${wk.label})`;

                            if (weekPriority === 'Alta') {
                              priorityBorderStyle = 'ring-2 ring-inset ring-red-500 border-red-500 shadow-xs';
                              priorityTopBarColor = 'bg-red-500';
                              priorityTitle += ' - PRIORITÀ ALTA 🔴';
                            } else if (weekPriority === 'Bassa') {
                              priorityBorderStyle = 'ring-2 ring-inset ring-sky-400 border-sky-400';
                              priorityTopBarColor = 'bg-sky-400';
                              priorityTitle += ' - Priorità Bassa 🔵';
                            }

                            return (
                              <td 
                                key={wIndex} 
                                onMouseDown={(e) => {
                                  if (e.button === 1) e.preventDefault();
                                }}
                                onAuxClick={(e) => {
                                  if (e.button === 1) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    window.open(`/pianificazione-personale?tab=commessa&commessaId=${encodeURIComponent(comm.id)}&weekId=${encodeURIComponent(wk.id)}`, '_blank');
                                  }
                                }}
                                onClick={(e) => handleWeekCellClick(e, comm, wk)}
                                className={`group/weekcell relative ${isUltraNarrow ? 'p-1' : 'p-2'} border-l border-b border-gray-100 align-top ${
                                  isCurrentWeek ? 'ring-2 ring-inset ring-blue-300' : ''
                                } ${priorityBorderStyle} cursor-pointer hover:bg-indigo-100/70 hover:ring-2 hover:ring-inset hover:ring-indigo-400 hover:shadow-md transition-all`}
                                style={{ backgroundColor: cellBg, minWidth: weekColumnMinWidth }}
                              >
                                <div 
                                  className="flex flex-col"
                                  style={{ 
                                    minHeight: isNarrow ? '30px' : '40px', 
                                    gap: '4px' 
                                  }}
                                >
                                  {/* Barra colorata tenue in cima alla casella stile intestazione */}
                                  <div
                                    onMouseDown={(e) => {
                                      if (e.button === 1) e.preventDefault();
                                    }}
                                    onAuxClick={(e) => {
                                      if (e.button === 1) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        window.open(`/pianificazione-personale?tab=commessa&commessaId=${encodeURIComponent(comm.id)}&weekId=${encodeURIComponent(wk.id)}`, '_blank');
                                      }
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleWeekCellClick(e, comm, wk);
                                    }}
                                    className={`w-full h-1.5 rounded-t-xs ${priorityTopBarColor} transition-colors cursor-pointer mb-1 shrink-0`}
                                    title={priorityTitle}
                                  />

                                  {assignedPeople.map((person, pIdx) => {
                                     const normName = person.name.toLowerCase().trim();
                                     const dip = dipendentiMap.get(normName);
                                     const dailyContractHours = dip?.tipo === 'collaboratore' ? 8 : (dip?.oreContratto ?? 8);
                                     const weeklyContractHours = dailyContractHours * 5;
                                     const leaves = resourceWeekLeavesMap.get(`${normName}_${wk.id}`) || [];

                                     const totalLeaveHoursInWeek = Math.min(
                                       weeklyContractHours,
                                       leaves.reduce((acc, l) => acc + getLeaveHoursForDay(l, dailyContractHours), 0)
                                     );
                                     const leavePctRaw = (totalLeaveHoursInWeek / weeklyContractHours) * 100;
                                     const leavePctInWeek = Math.round(leavePctRaw * 10) / 10;

                                     const availableContractHours = Math.max(0, weeklyContractHours - totalLeaveHoursInWeek);
                                     const fullLeaveDaysCount = leaves.filter(l => l.tipo === 'ferie' || l.tipo === 'malattia' || l.tipo === 'maternita' || l.frazioneTipo === 'giornata').length;
                                     const isAllWeekOnLeave = availableContractHours <= 0 || fullLeaveDaysCount >= 5;
                                     const hasLeaves = leaves.length > 0 && totalLeaveHoursInWeek > 0;

                                     const hours = Math.round(((person.pct * weeklyContractHours) / 100) * 10) / 10;
                                     const personDocId = `${person.name}-${wk.id}`;
                                     const totalPctInWeek = totalPctInWeekMap.get(personDocId.toLowerCase().trim()) || 0;
                                     const totalAssignedHoursInWeek = Math.round((totalPctInWeek * weeklyContractHours) / 100);

                                     const freeHoursInWeek = Math.max(0, weeklyContractHours - totalLeaveHoursInWeek - totalAssignedHoursInWeek);
                                     const freePctRaw = Math.max(0, (freeHoursInWeek / weeklyContractHours) * 100);
                                     const freePctInWeek = Math.round(freePctRaw * 10) / 10;

                                     const leaveDaysStr = leaves.map(l => l.giorno).join(', ');
                                     const leavesFormatted = hasLeaves
                                       ? `(${leaveDaysStr}) ${totalLeaveHoursInWeek}h (${leavePctInWeek}%)`
                                       : '0h (0%)';

                                     const displayHoursText = isAllWeekOnLeave ? `0h (Ferie)` : `${person.pct}% (${hours}h)`;
                                     const tooltipText = [
                                       `👤 ${person.name}`,
                                       `• Ore assegnate alla commessa: ${hours}h (${person.pct}%)`,
                                       `• Ore libere residue (settimana): ${freeHoursInWeek}h (${freePctInWeek}%)`,
                                       `• Ferie / Assenze: ${leavesFormatted}`,
                                       ``,
                                       `Clicca per gestire`
                                     ].join('\n');

                                     const isSelf = (!!myAssociatedName && areNamesEqual(person.name, myAssociatedName)) || (!!dip?.email && !!userEmail && dip.email.toLowerCase() === userEmail.toLowerCase());

                                     if (isUltraNarrow) {
                                       return (
                                         <div 
                                           key={pIdx} 
                                           onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                                           onAuxClick={(e) => handleResourcePillClick(e, person.name, person.pct, comm.id, comm.nome, wk.id, wk.label)}
                                           onClick={(e) => handleResourcePillClick(e, person.name, person.pct, comm.id, comm.nome, wk.id, wk.label)}
                                           className={`text-[8.5px] font-black text-center py-0.5 px-0.5 rounded border flex items-center justify-center shadow-2xs select-none cursor-pointer hover:ring-2 hover:ring-indigo-400 transition-all ${
                                             isSelf
                                               ? isAllWeekOnLeave
                                                 ? 'bg-amber-500 text-white border-amber-600 ring-2 ring-amber-300 shadow-xs'
                                                 : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white border-indigo-700 ring-2 ring-indigo-400 shadow-xs hover:brightness-110'
                                               : isAllWeekOnLeave
                                                 ? 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
                                                 : hasLeaves 
                                                   ? 'bg-rose-50 text-rose-800 border-rose-200 ring-1 ring-rose-300' 
                                                   : 'bg-indigo-50 text-indigo-900 border-indigo-150 hover:bg-indigo-100'
                                           }`}
                                           title={tooltipText}
                                         >
                                           {isAllWeekOnLeave ? '0h' : `${person.pct}%`}
                                         </div>
                                       );
                                     }

                                     if (isNarrow) {
                                       const initials = getInitials(person.name);
                                       return (
                                         <div 
                                           key={pIdx} 
                                           onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                                           onAuxClick={(e) => handleResourcePillClick(e, person.name, person.pct, comm.id, comm.nome, wk.id, wk.label)}
                                           onClick={(e) => handleResourcePillClick(e, person.name, person.pct, comm.id, comm.nome, wk.id, wk.label)}
                                           className={`text-[9px] font-bold py-0.5 px-1 rounded border flex items-center justify-between gap-0.5 shadow-2xs truncate select-none w-full cursor-pointer hover:ring-2 hover:ring-indigo-400 transition-all ${
                                             isSelf
                                               ? isAllWeekOnLeave
                                                 ? 'bg-amber-500 text-white border-amber-600 ring-2 ring-amber-300 shadow-xs font-black'
                                                 : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white border-indigo-700 ring-2 ring-indigo-400/80 shadow-xs font-black hover:brightness-110'
                                               : isAllWeekOnLeave
                                                 ? 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
                                                 : hasLeaves 
                                                   ? 'bg-rose-50 text-rose-800 border-rose-200' 
                                                   : 'bg-indigo-50 text-indigo-900 border-indigo-150 hover:bg-indigo-100'
                                           }`}
                                           title={tooltipText}
                                         >
                                           <span className="truncate text-left font-black">{initials}</span>
                                           <span className={`font-extrabold text-[8.5px] shrink-0 text-right ${isSelf ? 'text-white/95' : 'text-indigo-655'}`}>{displayHoursText}</span>
                                           {hasLeaves && <span className={`text-[7.5px] shrink-0 ml-0.5 ${isSelf ? 'text-amber-300' : 'text-amber-500'}`} title={`Assenze: ${leavesFormatted}`}>⚠️</span>}
                                         </div>
                                       );
                                     }

                                     return (
                                       <div 
                                         key={pIdx} 
                                         onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                                         onAuxClick={(e) => handleResourcePillClick(e, person.name, person.pct, comm.id, comm.nome, wk.id, wk.label)}
                                         onClick={(e) => handleResourcePillClick(e, person.name, person.pct, comm.id, comm.nome, wk.id, wk.label)}
                                         className={`text-[10px] p-1 px-1.5 rounded-lg border flex items-center justify-between gap-1 shadow-2xs w-full select-none cursor-pointer transition-all hover:scale-[1.02] ${
                                           isSelf
                                             ? isAllWeekOnLeave
                                               ? 'bg-amber-500 text-white border-amber-600 ring-2 ring-amber-300 shadow-xs'
                                               : 'bg-gradient-to-r from-indigo-600 via-indigo-700 to-blue-700 text-white border-indigo-700 ring-2 ring-indigo-400/70 shadow-xs font-bold hover:brightness-110'
                                             : isAllWeekOnLeave
                                               ? 'bg-amber-50/90 text-amber-950 border-amber-200 hover:bg-amber-100'
                                               : 'bg-indigo-50/80 text-indigo-950 border-indigo-100/60 hover:bg-indigo-100'
                                         }`}
                                         title={tooltipText}
                                       >
                                         <div className="flex items-center gap-1 min-w-0 flex-1">
                                           {hasLeaves && <span className={`text-[11px] shrink-0 ${isSelf ? 'text-amber-300' : 'text-amber-500'}`} title={`Assenze: ${leavesFormatted}`}>⚠️</span>}
                                           <span className={`truncate text-left ${isSelf ? 'font-black text-white' : 'font-bold text-gray-900'}`}>{person.name}</span>
                                         </div>
                                         <span className={`font-black shrink-0 text-right text-[10px] ${isSelf ? 'text-white bg-white/20 px-1 py-0.2 rounded' : 'text-indigo-650'}`}>{displayHoursText}</span>
                                       </div>
                                     );
                                   })}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
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

            {/* Legenda Priorità Settimanali & Assegnazioni Personali */}
            <div className="p-4 bg-gray-50/50 flex flex-wrap items-center justify-between gap-4 text-xs border-t border-gray-150">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase text-indigo-950 tracking-wider">Legenda:</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-gray-700">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-extrabold shadow-xs">
                  <User className="w-3.5 h-3.5 text-indigo-200" />
                  <span>Le Mie Assegnazioni (Tu)</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-50/80 border border-red-300 ring-2 ring-inset ring-red-500">
                  <span>🔴</span>
                  <span className="font-extrabold text-red-950">Priorità Alta</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-gray-200">
                  <span>⚪</span>
                  <span className="font-extrabold text-gray-700">Priorità Standard</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-50/80 border border-sky-300 ring-2 ring-inset ring-sky-400">
                  <span>🔵</span>
                  <span className="font-extrabold text-sky-950">Priorità Bassa</span>
                </div>
              </div>
            </div>

          </div>
        </>
      )}

      {/* TAB 2: GESTIONE CATALOGO (Per Admin, Soci, Coordinatori e Sviluppatori) */}
      {(activeTab === 'gestione' && canAccessCatalogo) && (
        <div className="space-y-8">
          <section className="bg-gradient-to-br from-emerald-50 to-teal-50 p-6 rounded-3xl border border-emerald-100 shadow-sm">
            <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
              <h3 className="text-xl font-bold text-emerald-900 flex items-center gap-2">
                <Briefcase className="w-6 h-6 text-emerald-600" /> Catalogo Commesse
              </h3>
            </div>
            
            {showNewCommessaForm && (
              <div className="mb-6 bg-white/70 backdrop-blur-md p-5 rounded-2xl border border-emerald-100 shadow-sm animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center pb-3 mb-4 border-b border-emerald-100/80">
                  <h4 className="text-sm font-black text-emerald-950 uppercase tracking-wider flex items-center gap-2">
                    <span>➕ Inserisci Nuova Commessa nel Catalogo</span>
                  </h4>
                </div>
                <form onSubmit={handleAddCommessa} className="space-y-4">
                
                {/* Selettore Cliente Ricercabile con pulsante Aggiungi Cliente */}
                <div className="relative">
                  <label className="block text-[10px] font-bold text-emerald-950 mb-1 ml-1">Cliente (Cerca e Seleziona)</label>
                  <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        placeholder="Digita per cercare un cliente per codice o ragione sociale..."
                        value={isClientDropdownOpen ? clientSearchText : (selectedClient ? selectedClient.nome : clientSearchText)}
                        onChange={e => {
                          setClientSearchText(e.target.value);
                          setIsClientDropdownOpen(true);
                        }}
                        onFocus={() => {
                          setClientSearchText('');
                          setIsClientDropdownOpen(true);
                        }}
                        className="w-full p-2.5 pr-8 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs cursor-pointer"
                      />
                      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                        <ChevronDown className="w-4 h-4" />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setNewClientNome('');
                        setIsNewClientModalOpen(true);
                      }}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2.5 rounded-xl font-extrabold text-xs shadow-md transition flex items-center gap-1.5 shrink-0 active:scale-95 cursor-pointer"
                    >
                      <Building2 className="w-4 h-4" />
                      <span>+ Aggiungi Cliente</span>
                    </button>
                  </div>
                  {isClientDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setIsClientDropdownOpen(false)}></div>
                      <div className="absolute left-0 right-0 z-20 mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden">
                        <div className="max-h-56 overflow-y-auto divide-y divide-gray-50 p-1">
                          {(() => {
                            const search = clientSearchText.toLowerCase();
                            const filtered = clientiList.filter(c =>
                              c.nome.toLowerCase().includes(search) || c.codice.includes(search)
                            );
                            if (filtered.length === 0) {
                              return (
                                <div className="p-3 text-xs text-gray-400 italic text-center">
                                  Nessun cliente trovato. <br />
                                  Usa il tasto <strong>"+ Aggiungi Cliente"</strong> per registrarlo.
                                </div>
                              );
                            }
                            return filtered.map(c => {
                              const isSelected = selectedClient?.codice === c.codice;
                              return (
                                <div
                                  key={c.codice}
                                  ref={el => {
                                    if (el && isSelected && el.parentElement) {
                                      el.parentElement.scrollTop = el.offsetTop;
                                    }
                                  }}
                                  onClick={() => {
                                    setSelectedClient(c);
                                    setClientSearchText(c.nome);
                                    setIsClientDropdownOpen(false);
                                  }}
                                  className={`p-2.5 text-xs cursor-pointer transition flex items-center justify-between rounded-lg ${
                                    isSelected ? 'bg-emerald-100/90 font-black text-emerald-950' : 'hover:bg-emerald-50 text-gray-700 font-bold'
                                  }`}
                                >
                                  <span>{isSelected ? '✓ ' : ''}{c.codice} - {c.nome}</span>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Selezione Tipologia e Anno per generazione automatica Codice Commessa */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-950 mb-1 ml-1">Tipologia Commessa *</label>
                    <select
                      value={newCommessaTipologia}
                      onChange={e => setNewCommessaTipologia(e.target.value)}
                      className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs"
                    >
                      {Object.entries(TIPOLOGIE_COMMESSE).map(([code, label]) => (
                        <option key={code} value={code}>{code} - {label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-emerald-950 mb-1 ml-1">Anno Riferimento *</label>
                    <input
                      type="text"
                      maxLength={2}
                      placeholder="Es. 26"
                      value={newCommessaAnno}
                      onChange={e => setNewCommessaAnno(e.target.value)}
                      className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-emerald-950 mb-1 ml-1">Progressivo Lettera (A-Z) *</label>
                    <input
                      type="text"
                      maxLength={1}
                      placeholder="Es. A"
                      value={newCommessaLettera}
                      onChange={e => setNewCommessaLettera(e.target.value.toUpperCase())}
                      className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs uppercase"
                    />
                  </div>
                </div>

                {/* Anteprima Codice */}
                <div className={`${isDuplicateCommessaCode ? 'bg-rose-100 border-rose-300 text-rose-900' : 'bg-emerald-100/60 border-emerald-200 text-emerald-900'} p-3 rounded-xl border text-center text-xs font-bold flex flex-col sm:flex-row items-center justify-center gap-2 transition-colors duration-200`}>
                  <span>Codice Commessa Generato:</span>
                  <span className={`flex items-center gap-2 text-sm font-black tracking-wider bg-white px-2.5 py-1 rounded shadow-sm ${isDuplicateCommessaCode ? 'text-rose-700 border border-rose-200 shadow-inner' : 'text-emerald-700'}`}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse" style={{backgroundColor: isDuplicateCommessaCode ? '#f43f5e' : (TIPOLOGIA_COLORS[newCommessaTipologia] || '#64748b')}}></span>
                    {selectedClient ? generatedCodiceCommessa : 'Seleziona un cliente'}
                  </span>
                  {isDuplicateCommessaCode && (
                    <span className="text-[10px] text-rose-600 font-extrabold uppercase animate-bounce shrink-0 ml-1.5">
                      ⚠️ Codice duplicato! Cambia il progressivo
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-emerald-950 mb-1 ml-1">Titolo della Commessa</label>
                  <input required type="text" placeholder="Es. Progettazione impianti Villa Gori" value={newCommessaTitolo} onChange={e => setNewCommessaTitolo(e.target.value)} className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-950 mb-1 ml-1">Data Inizio (Opzionale)</label>
                    <input type="date" value={newCommessaDataInizio} onChange={e => setNewCommessaDataInizio(e.target.value)} className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-medium text-gray-650 text-xs" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-950 mb-1 ml-1">Data Fine (Opzionale)</label>
                    <input type="date" value={newCommessaDataFine} onChange={e => setNewCommessaDataFine(e.target.value)} className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-medium text-gray-650 text-xs" />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-950 mb-1 ml-1">Responsabile (Coordinatori e Soci)</label>
                    <select value={newCommessaResponsabile} onChange={e => setNewCommessaResponsabile(e.target.value)} className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs">
                      <option value="">-- Nessuno --</option>
                      {responsabiliMacroAreeList.map(r => (
                        <option key={r.id} value={r.nome}>{r.nome}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Sezione Dettagli Progetto & SGQ */}
                <div className="bg-gradient-to-br from-indigo-50/50 to-emerald-50/50 p-5 rounded-2xl border border-indigo-100/60 space-y-4">
                  <div className="flex justify-between items-center border-b border-indigo-100/80 pb-2">
                    <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wide flex items-center gap-1.5">
                      🔀 Dettagli Progetto & SGQ
                    </h4>
                  </div>

                  {/* SUB-BLOCCO PROGETTI */}
                  <div className="bg-white p-4 rounded-xl border border-gray-200 space-y-3 shadow-xs">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-gray-150 pb-2">
                      <label className="block text-xs font-black text-indigo-950 uppercase tracking-wide">
                        Progetti
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setNewCommessaProgettiDescrizioni(prev => [...prev, '']);
                        }}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs transition shadow-xs active:scale-95 flex items-center gap-1.5 cursor-pointer shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Aggiungi Progetto</span>
                      </button>
                    </div>

                    {/* Box Nota d'Aiuto */}
                    <div className="bg-blue-50/90 border border-blue-200/80 p-3 rounded-xl text-xs text-blue-900 flex items-start gap-2.5 shadow-2xs">
                      <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">
                        <strong>Nota Progetti:</strong> Il progetto di Formazione è inserito di default all'apertura del form, ma è liberamente modificabile o eliminabile tramite il pulsante del cestino.
                      </span>
                    </div>

                    {/* Lista delle descrizioni progetti */}
                    <div className="space-y-2.5 pt-1">
                      {newCommessaProgettiDescrizioni.length === 0 ? (
                        <div className="text-[11px] text-gray-400 italic p-2 border border-dashed border-gray-200 rounded-xl text-center">
                          Nessun progetto inserito. Clicca su "+ Aggiungi Progetto" per inserire un progetto.
                        </div>
                      ) : (
                        newCommessaProgettiDescrizioni.map((desc, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-gray-500 w-16 shrink-0 text-right">
                              Prog. #{idx + 1}
                            </span>
                            <input
                              type="text"
                              required
                              placeholder="Inserisci la descrizione o l'identificativo del progetto..."
                              value={desc}
                              onChange={e => {
                                const val = e.target.value;
                                setNewCommessaProgettiDescrizioni(prev => prev.map((item, i) => i === idx ? val : item));
                              }}
                              className="flex-1 p-2.5 border border-gray-200 rounded-xl outline-none font-semibold text-gray-800 text-xs bg-gray-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-400"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setNewCommessaProgettiDescrizioni(prev => prev.filter((_, i) => i !== idx));
                              }}
                              className="text-gray-400 hover:text-red-600 p-2 rounded-xl hover:bg-red-50 transition cursor-pointer shrink-0"
                              title="Rimuovi questo progetto"
                            >
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* CAMPI COMUNI DELLA COMMESSA */}
                  <div className="bg-white p-4 rounded-xl border border-gray-200 space-y-4 shadow-xs">
                    <div className="text-[11px] font-black text-slate-800 uppercase tracking-wide border-b border-gray-150 pb-2">
                      ⚙️ Configurazioni Comuni per i Progetti della Commessa
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                      {/* Colonna 1: Project Manager */}
                      <div>
                        <label className="block text-[9px] font-bold text-gray-500 mb-1 ml-1">Project Manager (Opzionale)</label>
                        <select
                          value={newCommessaPM}
                          onChange={e => setNewCommessaPM(e.target.value)}
                          className="w-full p-2 border border-gray-200 rounded-lg bg-gray-50/50 focus:bg-white outline-none focus:ring-1 focus:ring-indigo-400 font-bold text-gray-700 text-xs h-[38px]"
                        >
                          <option value="">-- Nessun PM --</option>
                          {pmsList.map(pm => (
                            <option key={pm.id} value={pm.nome}>{pm.nome}</option>
                          ))}
                        </select>
                      </div>

                      {/* Colonna 2: Selettore Utenti da Abilitare */}
                      <div>
                        <label className="block text-[9px] font-bold text-indigo-900 mb-1 ml-1">Utenti da Abilitare (Tutte le Categorie)</label>
                        <select
                          value=""
                          onChange={e => {
                            const val = e.target.value;
                            if (val && !newCommessaUtentiDaAbilitare.includes(val)) {
                              setNewCommessaUtentiDaAbilitare(prev => [...prev, val]);
                            }
                          }}
                          className="w-full p-2 border border-indigo-200 rounded-lg bg-indigo-50/40 focus:bg-white outline-none focus:ring-1 focus:ring-emerald-400 font-bold text-gray-700 text-xs h-[38px]"
                        >
                          <option value="">+ Seleziona Utente da Abilitare...</option>
                          {dipendenti.filter(d => (!d.dataCessazione || d.dataCessazione >= new Date().toLocaleDateString('sv-SE')) && !isTechnicalUser(d) && !newCommessaUtentiDaAbilitare.includes(d.nome)).map(d => (
                            <option key={d.id} value={d.nome}>{d.nome} {d.macroArea ? `(${d.macroArea})` : ''}</option>
                          ))}
                        </select>
                      </div>

                      {/* Colonna 3: Lista Utenti Selezionati */}
                      <div>
                        <label className="block text-[9px] font-bold text-emerald-950 mb-1 ml-1">
                          Utenti Selezionati ({newCommessaUtentiDaAbilitare.length})
                        </label>
                        <div className="bg-emerald-50/50 p-2 border border-emerald-100 rounded-lg min-h-[38px] max-h-[120px] overflow-y-auto flex flex-wrap gap-1">
                          {newCommessaUtentiDaAbilitare.length === 0 ? (
                            <span className="text-[10px] text-gray-400 italic p-1">Nessun utente selezionato</span>
                          ) : (
                            newCommessaUtentiDaAbilitare.map(uName => (
                              <div key={uName} className="flex items-center gap-1.5 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-lg text-[10px] font-bold text-emerald-900 shadow-2xs">
                                <span>{uName}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNewCommessaUtentiDaAbilitare(prev => prev.filter(x => x !== uName));
                                  }}
                                  className="text-emerald-600 hover:text-emerald-800 transition cursor-pointer font-black"
                                >
                                  ✕
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ABILITATO SGQ */}
                    <div className="pt-2 border-t border-gray-150/60 flex items-center gap-3">
                      <div className="w-full sm:w-1/3">
                        <label className="block text-[9px] font-bold text-gray-500 mb-1 ml-1">Abilitato SGQ</label>
                        <select
                          value={newCommessaSGQ}
                          onChange={e => setNewCommessaSGQ(e.target.value as 'SI' | 'NO')}
                          className="w-full p-2 border border-gray-200 rounded-lg bg-gray-50/50 focus:bg-white outline-none focus:ring-1 focus:ring-indigo-400 font-bold text-gray-700 text-xs h-[38px]"
                        >
                          <option value="NO">NO</option>
                          <option value="SI">SI</option>
                        </select>
                      </div>
                    </div>

                    {newCommessaSGQ === 'SI' ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-indigo-50/30 p-3 rounded-lg border border-indigo-100/50">
                        <div>
                          <label className="block text-[9px] font-bold text-indigo-900 mb-1.5 ml-1">Verificatori / Validatori</label>
                          <div className="flex flex-wrap gap-1 mb-2">
                            {newCommessaVerificatori.length === 0 ? (
                              <span className="text-[10px] text-gray-400 italic ml-1">Nessun validatore</span>
                            ) : (
                              newCommessaVerificatori.map(vName => (
                                <div key={vName} className="flex items-center gap-1.5 bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded-lg text-[10px] font-bold text-indigo-900 shadow-sm animate-in fade-in zoom-in-95 duration-150">
                                  <span>{vName}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNewCommessaVerificatori(prev => prev.filter(x => x !== vName));
                                    }}
                                    className="text-indigo-450 hover:text-indigo-700 transition cursor-pointer"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                          <select
                            value=""
                            onChange={e => {
                              const val = e.target.value;
                              if (val && !newCommessaVerificatori.includes(val)) {
                                setNewCommessaVerificatori(prev => [...prev, val]);
                              }
                            }}
                            className="w-full p-2 border border-indigo-100 rounded-lg bg-white outline-none focus:ring-1 focus:ring-indigo-400 font-bold text-gray-700 text-xs"
                          >
                            <option value="">+ Aggiungi Validatore...</option>
                            {dipendenti.filter(d => (!d.dataCessazione || d.dataCessazione >= new Date().toLocaleDateString('sv-SE')) && !isTechnicalUser(d) && !newCommessaVerificatori.includes(d.nome)).map(d => (
                              <option key={d.id} value={d.nome}>{d.nome}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[9px] font-bold text-indigo-900 mb-1 ml-1">Compilatore (Facoltativo)</label>
                          <select
                            value={newCommessaCompilatore}
                            onChange={e => setNewCommessaCompilatore(e.target.value)}
                            className="w-full p-2 border border-indigo-100 rounded-lg bg-white outline-none focus:ring-1 focus:ring-indigo-400 font-bold text-gray-700 text-xs"
                          >
                            <option value="">-- Nessuno --</option>
                            {dipendenti.filter(d => (!d.dataCessazione || d.dataCessazione >= new Date().toLocaleDateString('sv-SE')) && !isTechnicalUser(d)).map(d => (
                              <option key={d.id} value={d.nome}>{d.nome}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 bg-emerald-50/30 p-3 rounded-lg border border-emerald-100/50">
                        <div>
                          <label className="block text-[9px] font-bold text-emerald-900 mb-1 ml-1 text-center">Senior Project</label>
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            value={newCommessaGiornateSenior || ''}
                            onChange={e => setNewCommessaGiornateSenior(Number(e.target.value) || 0)}
                            className="w-full p-2 border border-emerald-100 rounded-lg bg-white text-center font-bold text-gray-700 text-xs outline-none focus:ring-1 focus:ring-emerald-400"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-emerald-900 mb-1 ml-1 text-center">Project</label>
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            value={newCommessaGiornateProject || ''}
                            onChange={e => setNewCommessaGiornateProject(Number(e.target.value) || 0)}
                            className="w-full p-2 border border-emerald-100 rounded-lg bg-white text-center font-bold text-gray-700 text-xs outline-none focus:ring-1 focus:ring-emerald-400"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-emerald-900 mb-1 ml-1 text-center">Junior Project</label>
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            value={newCommessaGiornateJunior || ''}
                            onChange={e => setNewCommessaGiornateJunior(Number(e.target.value) || 0)}
                            className="w-full p-2 border border-emerald-100 rounded-lg bg-white text-center font-bold text-gray-700 text-xs outline-none focus:ring-1 focus:ring-emerald-400"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl transition font-bold shadow-md active:scale-95 text-sm flex items-center justify-center gap-1.5 mt-2 cursor-pointer">
                  Salva Commessa nel Catalogo
                </button>
              </form>
            </div>
          )}

            {/* PANNELLO FILTRI IN 2 RIGHE E SPAZIATO */}
            <div className="mb-4 bg-white/85 backdrop-blur-md p-4 rounded-2xl border border-emerald-100/90 shadow-sm space-y-3 relative z-30">
              {/* RIGA 1: RICERCA TESTUALE + CONTATORE COMMESSE + STAMPA & ESPORTA + SELETTORE STATO */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Campo di ricerca */}
                <div className="relative flex-1 min-w-[220px]">
                  <input
                    type="text"
                    placeholder="🔍 Cerca codice, titolo, cliente, note..."
                    value={searchCommessaQuery}
                    onChange={e => setSearchCommessaQuery(e.target.value)}
                    className="w-full p-2.5 pl-3 border border-emerald-100 rounded-xl bg-white focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs shadow-xs"
                  />
                </div>

                {/* Contatore, Stampa, Excel e Selettore Stato */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[11px] text-gray-600 font-extrabold bg-emerald-50/80 px-3 py-1.5 rounded-xl border border-emerald-100 shrink-0 whitespace-nowrap">
                    Visualizzate <strong className="text-emerald-950 font-black">{filteredAndSortedCatalogoCommesse.length}</strong> di {commesseGestibili.length} commesse
                  </span>

                  <button
                    type="button"
                    onClick={handlePrintCatalogoCommesse}
                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-sm active:scale-95 cursor-pointer shrink-0"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Stampa Lista</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportCatalogoExcel}
                    className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-sm active:scale-95 cursor-pointer shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Esporta Excel</span>
                  </button>

                  <div className="flex bg-gray-100 p-1 rounded-xl gap-1 border border-gray-200/60 shadow-inner shrink-0">
                    <button
                      type="button"
                      onClick={() => setCatalogoStatoFilter('Aperta')}
                      className={`px-3 py-1.5 rounded-lg text-[10.5px] font-black transition-all cursor-pointer ${
                        catalogoStatoFilter === 'Aperta'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                      title="Mostra solo commesse aperte (Default)"
                    >
                      🟢 Solo Aperte
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCatalogoStatoFilter('Tutte');
                        loadAllCommesse?.();
                      }}
                      className={`px-3 py-1.5 rounded-lg text-[10.5px] font-black transition-all cursor-pointer ${
                        catalogoStatoFilter === 'Tutte'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                      title="Mostra sia commesse aperte che chiuse"
                    >
                      ⚪ Tutte
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCatalogoStatoFilter('Chiusa');
                        loadAllCommesse?.();
                      }}
                      className={`px-3 py-1.5 rounded-lg text-[10.5px] font-black transition-all cursor-pointer ${
                        catalogoStatoFilter === 'Chiusa'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                      title="Mostra solo commesse chiuse"
                    >
                      🔴 Solo Chiuse
                    </button>
                  </div>
                </div>
              </div>

              {/* RIGA 2: FILTRI SPECIFICI RICERCABILI (CLIENTE, RESPONSABILE, PM, ANNO, TIPOLOGIA, RESET) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-2.5 border-t border-emerald-100/60 items-center">
                
                {/* 1. Cliente Ricercabile */}
                <div className="relative">
                  <label className="block text-[9.5px] font-extrabold text-gray-500 mb-1 ml-0.5 uppercase tracking-wide">Cliente</label>
                  <input
                    type="text"
                    placeholder="-- Tutti i Clienti --"
                    value={isCatClienteOpen ? catClienteSearch : (catalogoClienteFilter || '')}
                    onFocus={() => {
                      setIsCatClienteOpen(true);
                      setCatClienteSearch(catalogoClienteFilter || '');
                    }}
                    onChange={e => {
                      setCatClienteSearch(e.target.value);
                      if (!isCatClienteOpen) setIsCatClienteOpen(true);
                    }}
                    className="w-full p-2 border border-emerald-100 rounded-xl bg-white focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs shadow-xs"
                  />
                  {isCatClienteOpen && (
                    <>
                      <div className="fixed inset-0 z-[9999]" onClick={() => setIsCatClienteOpen(false)}></div>
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-emerald-200 rounded-xl shadow-2xl z-[10000] max-h-56 overflow-y-auto p-1.5 space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                        <div
                          onClick={() => {
                            setCatalogoClienteFilter('');
                            setIsCatClienteOpen(false);
                          }}
                          className={`p-2 text-xs cursor-pointer transition rounded-lg font-bold ${
                            !catalogoClienteFilter ? 'bg-emerald-100 text-emerald-950 font-black' : 'hover:bg-emerald-50 text-gray-600'
                          }`}
                        >
                          {!catalogoClienteFilter ? '✓ ' : ''}-- Tutti i Clienti --
                        </div>
                        {selectableClientiCatalogo
                          .filter(c => c.toLowerCase().includes((catClienteSearch || '').toLowerCase()))
                          .map(c => {
                            const isSelected = catalogoClienteFilter.trim().toLowerCase() === c.trim().toLowerCase();
                            return (
                              <div
                                key={c}
                                onClick={() => {
                                  setCatalogoClienteFilter(c);
                                  setIsCatClienteOpen(false);
                                }}
                                className={`p-2 text-xs cursor-pointer transition rounded-lg ${
                                  isSelected ? 'bg-emerald-100 text-emerald-950 font-black' : 'hover:bg-emerald-50 text-gray-700 font-bold'
                                }`}
                              >
                                {isSelected ? '✓ ' : ''}{c}
                              </div>
                            );
                          })}
                      </div>
                    </>
                  )}
                </div>

                {/* 2. Responsabile Ricercabile */}
                <div className="relative">
                  <label className="block text-[9.5px] font-extrabold text-gray-500 mb-1 ml-0.5 uppercase tracking-wide">Responsabile</label>
                  <input
                    type="text"
                    placeholder="-- Tutti i Responsabili --"
                    value={isCatRespOpen ? catRespSearch : (catalogoRespFilter || '')}
                    onFocus={() => {
                      setIsCatRespOpen(true);
                      setCatRespSearch(catalogoRespFilter || '');
                    }}
                    onChange={e => {
                      setCatRespSearch(e.target.value);
                      if (!isCatRespOpen) setIsCatRespOpen(true);
                    }}
                    className="w-full p-2 border border-emerald-100 rounded-xl bg-white focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs shadow-xs"
                  />
                  {isCatRespOpen && (
                    <>
                      <div className="fixed inset-0 z-[9999]" onClick={() => setIsCatRespOpen(false)}></div>
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-emerald-200 rounded-xl shadow-2xl z-[10000] max-h-56 overflow-y-auto p-1.5 space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                        <div
                          onClick={() => {
                            setCatalogoRespFilter('');
                            setIsCatRespOpen(false);
                          }}
                          className={`p-2 text-xs cursor-pointer transition rounded-lg font-bold ${
                            !catalogoRespFilter ? 'bg-emerald-100 text-emerald-950 font-black' : 'hover:bg-emerald-50 text-gray-600'
                          }`}
                        >
                          {!catalogoRespFilter ? '✓ ' : ''}-- Tutti i Responsabili --
                        </div>
                        {selectableResponsabiliCatalogo
                          .filter(r => r.toLowerCase().includes((catRespSearch || '').toLowerCase()))
                          .map(r => {
                            const isSelected = areNamesEqual(catalogoRespFilter, r);
                            return (
                              <div
                                key={r}
                                onClick={() => {
                                  setCatalogoRespFilter(r);
                                  setIsCatRespOpen(false);
                                }}
                                className={`p-2 text-xs cursor-pointer transition rounded-lg ${
                                  isSelected ? 'bg-emerald-100 text-emerald-950 font-black' : 'hover:bg-emerald-50 text-gray-700 font-bold'
                                }`}
                              >
                                {isSelected ? '✓ ' : ''}{r}
                              </div>
                            );
                          })}
                      </div>
                    </>
                  )}
                </div>

                {/* 3. PM Ricercabile */}
                <div className="relative">
                  <label className="block text-[9.5px] font-extrabold text-gray-500 mb-1 ml-0.5 uppercase tracking-wide">Project Manager (PM)</label>
                  <input
                    type="text"
                    placeholder="-- Tutti i PM --"
                    value={isCatPMOpen ? catPMSearch : (catalogoPMFilter || '')}
                    onFocus={() => {
                      setIsCatPMOpen(true);
                      setCatPMSearch(catalogoPMFilter || '');
                    }}
                    onChange={e => {
                      setCatPMSearch(e.target.value);
                      if (!isCatPMOpen) setIsCatPMOpen(true);
                    }}
                    className="w-full p-2 border border-emerald-100 rounded-xl bg-white focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs shadow-xs"
                  />
                  {isCatPMOpen && (
                    <>
                      <div className="fixed inset-0 z-[9999]" onClick={() => setIsCatPMOpen(false)}></div>
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-emerald-200 rounded-xl shadow-2xl z-[10000] max-h-56 overflow-y-auto p-1.5 space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                        <div
                          onClick={() => {
                            setCatalogoPMFilter('');
                            setIsCatPMOpen(false);
                          }}
                          className={`p-2 text-xs cursor-pointer transition rounded-lg font-bold ${
                            !catalogoPMFilter ? 'bg-emerald-100 text-emerald-950 font-black' : 'hover:bg-emerald-50 text-gray-600'
                          }`}
                        >
                          {!catalogoPMFilter ? '✓ ' : ''}-- Tutti i PM --
                        </div>
                        {selectablePMsCatalogo
                          .filter(pm => pm.toLowerCase().includes((catPMSearch || '').toLowerCase()))
                          .map(pm => {
                            const isSelected = areNamesEqual(catalogoPMFilter, pm);
                            return (
                              <div
                                key={pm}
                                onClick={() => {
                                  setCatalogoPMFilter(pm);
                                  setIsCatPMOpen(false);
                                }}
                                className={`p-2 text-xs cursor-pointer transition rounded-lg ${
                                  isSelected ? 'bg-emerald-100 text-emerald-950 font-black' : 'hover:bg-emerald-50 text-gray-700 font-bold'
                                }`}
                              >
                                {isSelected ? '✓ ' : ''}{pm}
                              </div>
                            );
                          })}
                      </div>
                    </>
                  )}
                </div>

                {/* 4. Anno Ricercabile */}
                <div className="relative">
                  <label className="block text-[9.5px] font-extrabold text-gray-500 mb-1 ml-0.5 uppercase tracking-wide">Anno</label>
                  <input
                    type="text"
                    placeholder="-- Tutti gli Anni --"
                    value={isCatAnnoOpen ? catAnnoSearch : (catalogoAnnoFilter || '')}
                    onFocus={() => {
                      setIsCatAnnoOpen(true);
                      setCatAnnoSearch(catalogoAnnoFilter || '');
                    }}
                    onChange={e => {
                      setCatAnnoSearch(e.target.value);
                      if (!isCatAnnoOpen) setIsCatAnnoOpen(true);
                    }}
                    className="w-full p-2 border border-emerald-100 rounded-xl bg-white focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs shadow-xs"
                  />
                  {isCatAnnoOpen && (
                    <>
                      <div className="fixed inset-0 z-[9999]" onClick={() => setIsCatAnnoOpen(false)}></div>
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-emerald-200 rounded-xl shadow-2xl z-[10000] max-h-56 overflow-y-auto p-1.5 space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                        <div
                          onClick={() => {
                            setCatalogoAnnoFilter('');
                            setIsCatAnnoOpen(false);
                          }}
                          className={`p-2 text-xs cursor-pointer transition rounded-lg font-bold ${
                            !catalogoAnnoFilter ? 'bg-emerald-100 text-emerald-950 font-black' : 'hover:bg-emerald-50 text-gray-600'
                          }`}
                        >
                          {!catalogoAnnoFilter ? '✓ ' : ''}-- Tutti gli Anni --
                        </div>
                        {selectableAnniCatalogo
                          .filter(a => a.toLowerCase().includes((catAnnoSearch || '').toLowerCase()))
                          .map(a => {
                            const isSelected = catalogoAnnoFilter === a;
                            return (
                              <div
                                key={a}
                                onClick={() => {
                                  setCatalogoAnnoFilter(a);
                                  setIsCatAnnoOpen(false);
                                }}
                                className={`p-2 text-xs cursor-pointer transition rounded-lg ${
                                  isSelected ? 'bg-emerald-100 text-emerald-950 font-black' : 'hover:bg-emerald-50 text-gray-700 font-bold'
                                }`}
                              >
                                {isSelected ? '✓ ' : ''}{a}
                              </div>
                            );
                          })}
                      </div>
                    </>
                  )}
                </div>

                {/* 5. Tipologia Ricercabile & Reset */}
                <div className="flex gap-2 items-end">
                  <div className="flex-1 relative">
                    <label className="block text-[9.5px] font-extrabold text-gray-500 mb-1 ml-0.5 uppercase tracking-wide">Tipologia</label>
                    <input
                      type="text"
                      placeholder="-- Tutte le Tipologie --"
                      value={isCatTipologiaOpen ? catTipologiaSearch : (catalogoTipologiaFilter ? `${catalogoTipologiaFilter} - ${TIPOLOGIE_COMMESSE[catalogoTipologiaFilter] || catalogoTipologiaFilter}` : '')}
                      onFocus={() => {
                        setIsCatTipologiaOpen(true);
                        setCatTipologiaSearch(catalogoTipologiaFilter || '');
                      }}
                      onChange={e => {
                        setCatTipologiaSearch(e.target.value);
                        if (!isCatTipologiaOpen) setIsCatTipologiaOpen(true);
                      }}
                      className="w-full p-2 border border-emerald-100 rounded-xl bg-white focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs shadow-xs"
                    />
                    {isCatTipologiaOpen && (
                      <>
                        <div className="fixed inset-0 z-[9999]" onClick={() => setIsCatTipologiaOpen(false)}></div>
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-emerald-200 rounded-xl shadow-2xl z-[10000] max-h-56 overflow-y-auto p-1.5 space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                          <div
                            onClick={() => {
                              setCatalogoTipologiaFilter('');
                              setIsCatTipologiaOpen(false);
                            }}
                            className={`p-2 text-xs cursor-pointer transition rounded-lg font-bold ${
                              !catalogoTipologiaFilter ? 'bg-emerald-100 text-emerald-950 font-black' : 'hover:bg-emerald-50 text-gray-600'
                            }`}
                          >
                            {!catalogoTipologiaFilter ? '✓ ' : ''}-- Tutte le Tipologie --
                          </div>
                          {selectableTipologieCatalogo
                            .filter(tip => {
                              const search = (catTipologiaSearch || '').toLowerCase();
                              const desc = (TIPOLOGIE_COMMESSE[tip] || '').toLowerCase();
                              return tip.toLowerCase().includes(search) || desc.includes(search);
                            })
                            .map(tip => {
                              const isSelected = catalogoTipologiaFilter === tip;
                              return (
                                <div
                                  key={tip}
                                  onClick={() => {
                                    setCatalogoTipologiaFilter(tip);
                                    setIsCatTipologiaOpen(false);
                                  }}
                                  className={`p-2 text-xs cursor-pointer transition rounded-lg ${
                                    isSelected ? 'bg-emerald-100 text-emerald-950 font-black' : 'hover:bg-emerald-50 text-gray-700 font-bold'
                                  }`}
                                >
                                  {isSelected ? '✓ ' : ''}{tip} - {TIPOLOGIE_COMMESSE[tip] || tip}
                                </div>
                              );
                            })}
                        </div>
                      </>
                    )}
                  </div>
                  {hasActiveCatalogoFilters && (
                    <button
                      type="button"
                      onClick={resetCatalogoFilters}
                      className="p-2 h-[35px] text-xs font-extrabold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition cursor-pointer shrink-0"
                      title="Azzera tutti i filtri"
                    >
                      Reset
                    </button>
                  )}
                </div>

              </div>
            </div>

            <div className="max-h-[480px] overflow-auto bg-white/50 rounded-xl border border-emerald-100">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-emerald-100 text-emerald-900 font-extrabold shadow-sm z-10 select-none">
                  <tr>
                    <th className="p-2.5 cursor-pointer hover:bg-emerald-200 transition" onClick={() => handleColumnHeaderSort('codice')}>
                      Codice {catalogoSortBy === 'codice' ? (catalogoSortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </th>
                    <th className="p-2.5 cursor-pointer hover:bg-emerald-200 transition" onClick={() => handleColumnHeaderSort('anno')}>
                      Anno {catalogoSortBy === 'anno' ? (catalogoSortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </th>
                    <th className="p-2.5 cursor-pointer hover:bg-emerald-200 transition" onClick={() => handleColumnHeaderSort('tipologia')}>
                      Tip. {catalogoSortBy === 'tipologia' ? (catalogoSortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </th>
                    <th className="p-2.5 cursor-pointer hover:bg-emerald-200 transition" onClick={() => handleColumnHeaderSort('titolo')}>
                      Titolo {catalogoSortBy === 'titolo' ? (catalogoSortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </th>
                    <th className="p-2.5 cursor-pointer hover:bg-emerald-200 transition" onClick={() => handleColumnHeaderSort('cliente')}>
                      Cliente {catalogoSortBy === 'cliente' ? (catalogoSortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </th>
                    <th className="p-2.5 cursor-pointer hover:bg-emerald-200 transition" onClick={() => handleColumnHeaderSort('dataApertura')}>
                      Data Apertura {catalogoSortBy === 'dataApertura' ? (catalogoSortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </th>
                    <th className="p-2.5 text-center cursor-pointer hover:bg-emerald-200 transition" onClick={() => handleColumnHeaderSort('stato')}>
                      Stato {catalogoSortBy === 'stato' ? (catalogoSortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </th>
                    <th className="p-2.5 cursor-pointer hover:bg-emerald-200 transition" onClick={() => handleColumnHeaderSort('responsabile')}>
                      Resp. {catalogoSortBy === 'responsabile' ? (catalogoSortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </th>
                    <th className="p-2.5 cursor-pointer hover:bg-emerald-200 transition" onClick={() => handleColumnHeaderSort('pm')}>
                      PM {catalogoSortBy === 'pm' ? (catalogoSortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </th>
                    <th className="p-2.5 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-50/60 font-medium text-emerald-950">
                  {filteredAndSortedCatalogoCommesse.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-8 text-center text-gray-400 font-bold italic">
                        Nessuna commessa trovata con i filtri selezionati.
                      </td>
                    </tr>
                  ) : (
                    filteredAndSortedCatalogoCommesse.map(c => {
                      const computedTipologia = getParsedField(c, 'tipologia');
                      const computedAnno = getParsedField(c, 'anno');
                      const computedColor = TIPOLOGIA_COLORS[computedTipologia] || c.colore || '#64748b';

                      return (
                        <tr key={c.id} className="hover:bg-emerald-50/50 transition-colors">
                          <td className="p-2.5 font-bold whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-inner" style={{backgroundColor: computedColor}}></span>
                              {(c as any).codiceCommessa || (c.nome ? c.nome.split(' - ')[0] : 'Commessa')}
                            </div>
                          </td>
                          <td className="p-2.5">{computedAnno}</td>
                          <td className="p-2.5">{computedTipologia}</td>
                          <td className="p-2.5 max-w-[200px] truncate" title={(c as any).titolo || c.nome}>{(c as any).titolo || c.nome}</td>
                          <td className="p-2.5 max-w-[150px] truncate" title={(c as any).cliente || ''}>{(c as any).cliente || ''}</td>
                          <td className="p-2.5 whitespace-nowrap text-gray-600 font-semibold">
                            {(c as any).dataApertura ? new Date((c as any).dataApertura).toLocaleDateString('it-IT') : '-'}
                          </td>
                          <td className="p-2.5 text-center">
                            <span className={`px-2 py-0.5 rounded-full font-black text-[9px] uppercase tracking-wider ${
                              (c as any).stato === 'Aperta' || !c.hasOwnProperty('stato') ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-650'
                            }`}>
                              {(c as any).stato || 'Aperta'}
                            </span>
                          </td>
                          <td className="p-2.5 truncate max-w-[100px]" title={getOfficialName(c.responsabile) || ''}>{getOfficialName(c.responsabile) || ''}</td>
                          <td className="p-2.5 truncate max-w-[120px]" title={formatPMField(c.pm) || ''}>{formatPMField(c.pm) || ''}</td>
                          <td className="p-2.5 text-center">
                            {canManageCatalogo ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <button 
                                  onClick={() => handleOpenEditModal(c)} 
                                  className="text-emerald-650 hover:text-blue-655 p-1 transition-colors cursor-pointer"
                                  title="Modifica commessa"
                                >
                                  <Pencil className="w-3.5 h-3.5"/>
                                </button>
                                <button 
                                  onClick={() => handleRemoveCommessa(c.id, c.nome)} 
                                  className="text-emerald-650 hover:text-red-655 p-1 transition-colors cursor-pointer"
                                  title="Elimina commessa"
                                >
                                  <Trash2 className="w-3.5 h-3.5"/>
                                </button>
                              </div>
                            ) : (
                              <span className="text-gray-300 text-[10px] italic">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* MODALE MODIFICA COMPLETA COMMESSA (GESTIONE CATALOGO) */}
      {editingCommessa && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-4xl w-full border border-gray-150 flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header Modale (Fisso in alto) */}
            <div className="flex justify-between items-center shrink-0 border-b border-gray-100 p-6 pb-4 bg-white rounded-t-[2rem]">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl border border-indigo-100">
                  <Pencil className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900 tracking-tight">
                    Modifica Commessa nel Catalogo
                  </h3>
                  <p className="text-xs text-gray-500 font-semibold">
                    Gestisci periodo, responsabile, progetti e dettagli operativi della commessa
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setEditingCommessa(null)} 
                className="text-gray-400 hover:text-gray-600 p-2 rounded-xl hover:bg-gray-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body Modale (Scrollabile Internamente, protetto dentro la finestra arrotondata) */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              
              {/* Banner Codice Commessa & Stato */}
              <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-900 p-4 rounded-2xl text-white shadow-md flex justify-between items-center">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-wider text-blue-300">
                    Codice Commessa (Non Modificabile)
                  </div>
                  <div className="font-black text-xl text-white">
                    {editingCommessa.codiceCommessa || (editingCommessa.nome ? editingCommessa.nome.split(' - ')[0] : 'Commessa')}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-300">Stato commessa:</span>
                  <select
                    value={editStato}
                    onChange={e => setEditStato(e.target.value as 'Aperta' | 'Chiusa')}
                    className={`px-3 py-1 rounded-xl text-xs font-black uppercase border-0 outline-none cursor-pointer shadow-sm ${
                      editStato === 'Chiusa' ? 'bg-rose-500 text-white' : 'bg-emerald-500 text-white'
                    }`}
                  >
                    <option value="Aperta" className="bg-white text-gray-900 font-bold">🟢 Aperta</option>
                    <option value="Chiusa" className="bg-white text-gray-900 font-bold">🔴 Chiusa</option>
                  </select>
                </div>
              </div>

              {/* Blocco Dati Anagrafici Congelati (Non Modificabili per preservare l'integrità del codice) */}
              <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80 space-y-3">
                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                  <span className="text-[10.5px] font-black text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                    🔒 Dati Anagrafici Strutturali (Non Modificabili)
                  </span>
                  <span className="text-[9.5px] text-slate-400 font-bold italic">
                    Generati all'apertura per garantire l'univocità del codice
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  {/* Titolo Commessa */}
                  <div className="sm:col-span-2">
                    <label className="block text-[9.5px] font-bold text-slate-500 mb-1 ml-0.5">Titolo Commessa</label>
                    <input
                      type="text"
                      disabled
                      value={editTitolo}
                      className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-100 text-slate-600 font-bold text-xs cursor-not-allowed shadow-2xs"
                      title="Il titolo anagrafico della commessa non è modificabile dopo la registrazione"
                    />
                  </div>

                  {/* Cliente */}
                  <div>
                    <label className="block text-[9.5px] font-bold text-slate-500 mb-1 ml-0.5">Cliente</label>
                    <input
                      type="text"
                      disabled
                      value={editCliente || 'Non specificato'}
                      className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-100 text-slate-600 font-bold text-xs cursor-not-allowed shadow-2xs"
                      title="Il cliente della commessa non è modificabile dopo la registrazione"
                    />
                  </div>

                  {/* Anno & Tipologia */}
                  <div>
                    <label className="block text-[9.5px] font-bold text-slate-500 mb-1 ml-0.5">Anno & Tipologia</label>
                    <input
                      type="text"
                      disabled
                      value={`${editAnno} • Tip. ${editTipologia}`}
                      className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-100 text-slate-600 font-bold text-xs cursor-not-allowed shadow-2xs"
                      title="Anno e tipologia non sono modificabili dopo la registrazione"
                    />
                  </div>
                </div>
              </div>

              {/* Form Periodo & Responsabile (Modificabili) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
                
                {/* Data Inizio */}
                <div>
                  <label className="block text-[10px] font-bold text-gray-700 mb-1 ml-1">Data Inizio</label>
                  <input
                    type="date"
                    value={editDataInizio}
                    onChange={e => setEditDataInizio(e.target.value)}
                    className="w-full p-2.5 border border-gray-200 rounded-xl bg-gray-50/50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 font-bold text-gray-800 text-xs"
                  />
                </div>

                {/* Data Fine */}
                <div>
                  <label className="block text-[10px] font-bold text-gray-700 mb-1 ml-1">Data Fine</label>
                  <input
                    type="date"
                    value={editDataFine}
                    onChange={e => setEditDataFine(e.target.value)}
                    className="w-full p-2.5 border border-gray-200 rounded-xl bg-gray-50/50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 font-bold text-gray-800 text-xs"
                  />
                </div>

                {/* Responsabile Commessa */}
                <div>
                  <label className="block text-[10px] font-bold text-gray-700 mb-1 ml-1">Responsabile Commessa</label>
                  <select
                    value={editResponsabile}
                    onChange={e => setEditResponsabile(e.target.value)}
                    className="w-full p-2.5 border border-gray-200 rounded-xl bg-gray-50/50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 font-bold text-gray-800 text-xs"
                  >
                    <option value="">-- Nessuno --</option>
                    {responsabiliMacroAreeList.map(r => (
                      <option key={r.id} value={r.nome}>{r.nome}</option>
                    ))}
                  </select>
                </div>

              </div>

              {/* Sezione Dettagli Progetto & SGQ (Modificabili) */}
              <div className="bg-gradient-to-br from-indigo-50/50 to-emerald-50/50 p-5 rounded-2xl border border-indigo-100/60 space-y-4">
                <div className="flex justify-between items-center border-b border-indigo-100/80 pb-2">
                  <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wide flex items-center gap-1.5">
                    🔀 Dettagli Progetto & SGQ
                  </h4>
                </div>

                {/* SUB-BLOCCO PROGETTI */}
                <div className="bg-white p-4 rounded-xl border border-gray-200 space-y-3 shadow-xs">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-gray-150 pb-2">
                    <label className="block text-xs font-black text-indigo-950 uppercase tracking-wide">
                      Progetti
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setEditProgettiDescrizioni(prev => [...prev, '']);
                      }}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs transition shadow-xs active:scale-95 flex items-center gap-1.5 cursor-pointer shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Aggiungi Progetto</span>
                    </button>
                  </div>

                  <div className="space-y-2.5 pt-1">
                    {editProgettiDescrizioni.length === 0 ? (
                      <div className="text-[11px] text-gray-400 italic p-2 border border-dashed border-gray-200 rounded-xl text-center">
                        Nessun progetto inserito. Clicca su "Aggiungi Progetto" per inserire un progetto.
                      </div>
                    ) : (
                      editProgettiDescrizioni.map((desc, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-gray-500 w-16 shrink-0 text-right">
                            Prog. #{idx + 1}
                          </span>
                          <input
                            type="text"
                            required
                            placeholder="Inserisci la descrizione o l'identificativo del progetto..."
                            value={desc}
                            onChange={e => {
                              const val = e.target.value;
                              setEditProgettiDescrizioni(prev => prev.map((item, i) => i === idx ? val : item));
                            }}
                            className="flex-1 p-2.5 border border-gray-200 rounded-xl outline-none font-semibold text-gray-800 text-xs bg-gray-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-400"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setEditProgettiDescrizioni(prev => prev.filter((_, i) => i !== idx));
                            }}
                            className="text-gray-400 hover:text-red-600 p-2 rounded-xl hover:bg-red-50 transition cursor-pointer shrink-0"
                            title="Rimuovi questo progetto"
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* CAMPI COMUNI DELLA COMMESSA */}
                <div className="bg-white p-4 rounded-xl border border-gray-200 space-y-4 shadow-xs">
                  <div className="text-[11px] font-black text-slate-800 uppercase tracking-wide border-b border-gray-150 pb-2">
                    ⚙️ Configurazioni Comuni per i Progetti della Commessa
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                    {/* Project Manager */}
                    <div>
                      <label className="block text-[9px] font-bold text-gray-500 mb-1 ml-1">Project Manager (Opzionale)</label>
                      <select
                        value={editPM}
                        onChange={e => setEditPM(e.target.value)}
                        className="w-full p-2 border border-gray-200 rounded-lg bg-gray-50/50 focus:bg-white outline-none focus:ring-1 focus:ring-indigo-400 font-bold text-gray-700 text-xs h-[38px]"
                      >
                        <option value="">-- Nessun PM --</option>
                        {pmsList.map(pm => (
                          <option key={pm.id} value={pm.nome}>{pm.nome}</option>
                        ))}
                      </select>
                    </div>

                    {/* Selettore Utenti da Abilitare */}
                    <div>
                      <label className="block text-[9px] font-bold text-indigo-900 mb-1 ml-1">Utenti da Abilitare (Tutte le Categorie)</label>
                      <select
                        value=""
                        onChange={e => {
                          const val = e.target.value;
                          if (val && !editUtentiDaAbilitare.includes(val)) {
                            setEditUtentiDaAbilitare(prev => [...prev, val]);
                          }
                        }}
                        className="w-full p-2 border border-indigo-200 rounded-lg bg-indigo-50/40 focus:bg-white outline-none focus:ring-1 focus:ring-emerald-400 font-bold text-gray-700 text-xs h-[38px]"
                      >
                        <option value="">+ Seleziona Utente da Abilitare...</option>
                        {dipendenti.filter(d => (!d.dataCessazione || d.dataCessazione >= new Date().toLocaleDateString('sv-SE')) && !isTechnicalUser(d) && !editUtentiDaAbilitare.includes(d.nome)).map(d => (
                          <option key={d.id} value={d.nome}>{d.nome} {d.macroArea ? `(${d.macroArea})` : ''}</option>
                        ))}
                      </select>
                    </div>

                    {/* Lista Utenti Selezionati */}
                    <div>
                      <label className="block text-[9px] font-bold text-emerald-950 mb-1 ml-1">
                        Utenti Selezionati ({editUtentiDaAbilitare.length})
                      </label>
                      <div className="bg-emerald-50/50 p-2 border border-emerald-100 rounded-lg min-h-[38px] max-h-[120px] overflow-y-auto flex flex-wrap gap-1">
                        {editUtentiDaAbilitare.length === 0 ? (
                          <span className="text-[10px] text-gray-400 italic p-1">Nessun utente selezionato</span>
                        ) : (
                          editUtentiDaAbilitare.map(uName => (
                            <div key={uName} className="flex items-center gap-1.5 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-lg text-[10px] font-bold text-emerald-900 shadow-2xs">
                              <span>{uName}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditUtentiDaAbilitare(prev => prev.filter(x => x !== uName));
                                }}
                                className="text-emerald-600 hover:text-emerald-800 transition cursor-pointer font-black"
                              >
                                ✕
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ABILITATO SGQ */}
                  <div className="pt-2 border-t border-gray-150/60 flex items-center gap-3">
                    <div className="w-full sm:w-1/3">
                      <label className="block text-[9px] font-bold text-gray-500 mb-1 ml-1">Abilitato SGQ</label>
                      <select
                        value={editSGQ}
                        onChange={e => setEditSGQ(e.target.value as 'SI' | 'NO')}
                        className="w-full p-2 border border-gray-200 rounded-lg bg-gray-50/50 focus:bg-white outline-none focus:ring-1 focus:ring-indigo-400 font-bold text-gray-700 text-xs h-[38px]"
                      >
                        <option value="NO">NO</option>
                        <option value="SI">SI</option>
                      </select>
                    </div>
                  </div>

                  {editSGQ === 'SI' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-indigo-50/30 p-3 rounded-lg border border-indigo-100/50">
                      <div>
                        <label className="block text-[9px] font-bold text-indigo-900 mb-1.5 ml-1">Verificatori / Validatori</label>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {editVerificatori.length === 0 ? (
                            <span className="text-[10px] text-gray-400 italic ml-1">Nessun validatore</span>
                          ) : (
                            editVerificatori.map(vName => (
                              <div key={vName} className="flex items-center gap-1.5 bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded-lg text-[10px] font-bold text-indigo-900 shadow-sm animate-in fade-in zoom-in-95 duration-150">
                                <span>{vName}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditVerificatori(prev => prev.filter(x => x !== vName));
                                  }}
                                  className="text-indigo-450 hover:text-indigo-700 transition cursor-pointer"
                                >
                                  ✕
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                        <select
                          value=""
                          onChange={e => {
                            const val = e.target.value;
                            if (val && !editVerificatori.includes(val)) {
                              setEditVerificatori(prev => [...prev, val]);
                            }
                          }}
                          className="w-full p-2 border border-indigo-100 rounded-lg bg-white outline-none focus:ring-1 focus:ring-indigo-400 font-bold text-gray-700 text-xs"
                        >
                          <option value="">+ Aggiungi Validatore...</option>
                          {dipendenti.filter(d => (!d.dataCessazione || d.dataCessazione >= new Date().toLocaleDateString('sv-SE')) && !isTechnicalUser(d) && !editVerificatori.includes(d.nome)).map(d => (
                            <option key={d.id} value={d.nome}>{d.nome}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[9px] font-bold text-indigo-900 mb-1 ml-1">Compilatore (Facoltativo)</label>
                        <select
                          value={editCompilatore}
                          onChange={e => setEditCompilatore(e.target.value)}
                          className="w-full p-2 border border-indigo-100 rounded-lg bg-white outline-none focus:ring-1 focus:ring-indigo-400 font-bold text-gray-700 text-xs"
                        >
                          <option value="">-- Nessuno --</option>
                          {dipendenti.filter(d => (!d.dataCessazione || d.dataCessazione >= new Date().toLocaleDateString('sv-SE')) && !isTechnicalUser(d)).map(d => (
                            <option key={d.id} value={d.nome}>{d.nome}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 bg-emerald-50/30 p-3 rounded-lg border border-emerald-100/50">
                      <div>
                        <label className="block text-[9px] font-bold text-emerald-900 mb-1 ml-1 text-center">Senior Project</label>
                        <input
                          type="number"
                          min={0}
                          placeholder="0"
                          value={editGiornateSenior || ''}
                          onChange={e => setEditGiornateSenior(Number(e.target.value) || 0)}
                          className="w-full p-2 border border-emerald-100 rounded-lg bg-white text-center font-bold text-gray-700 text-xs outline-none focus:ring-1 focus:ring-emerald-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-emerald-900 mb-1 ml-1 text-center">Project</label>
                        <input
                          type="number"
                          min={0}
                          placeholder="0"
                          value={editGiornateProject || ''}
                          onChange={e => setEditGiornateProject(Number(e.target.value) || 0)}
                          className="w-full p-2 border border-emerald-100 rounded-lg bg-white text-center font-bold text-gray-700 text-xs outline-none focus:ring-1 focus:ring-emerald-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-emerald-900 mb-1 ml-1 text-center">Junior Project</label>
                        <input
                          type="number"
                          min={0}
                          placeholder="0"
                          value={editGiornateJunior || ''}
                          onChange={e => setEditGiornateJunior(Number(e.target.value) || 0)}
                          className="w-full p-2 border border-emerald-100 rounded-lg bg-white text-center font-bold text-gray-700 text-xs outline-none focus:ring-1 focus:ring-emerald-400"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* Footer Modale: Annulla, Re-invia E-mail & Salva (Fisso in basso) */}
            <div className="flex justify-between items-center p-6 pt-4 border-t border-gray-150 bg-white rounded-b-[2rem] shrink-0 gap-3 flex-wrap">
              <button 
                type="button" 
                onClick={() => setEditingCommessa(null)} 
                className="py-2.5 px-5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-100 text-xs font-extrabold transition cursor-pointer"
              >
                Annulla
              </button>

              <div className="flex items-center gap-3">
                {editStato === 'Chiusa' ? (
                  <button 
                    type="button" 
                    onClick={() => handleReinvioMailChiusura(editingCommessa)} 
                    className="py-2.5 px-4 rounded-xl border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 text-xs font-black transition cursor-pointer flex items-center gap-1.5 active:scale-95 shadow-xs"
                    title="Invia nuovamente l'e-mail riepilogativa di chiusura per questa commessa"
                  >
                    <Mail className="w-4 h-4 text-rose-600" />
                    <span>Re-invia E-mail Chiusura</span>
                  </button>
                ) : (
                  <button 
                    type="button" 
                    onClick={() => handleReinvioMailApertura(editingCommessa)} 
                    className="py-2.5 px-4 rounded-xl border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 text-xs font-black transition cursor-pointer flex items-center gap-1.5 active:scale-95 shadow-xs"
                    title="Invia nuovamente l'e-mail riepilogativa di apertura per questa commessa"
                  >
                    <Mail className="w-4 h-4 text-indigo-600" />
                    <span>Re-invia E-mail Apertura</span>
                  </button>
                )}

                <button 
                  type="button" 
                  onClick={handleSaveEditCommessa} 
                  className="py-2.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black shadow-md transition cursor-pointer flex items-center gap-2 active:scale-95"
                >
                  💾 Salva Modifiche Commessa
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* MODALE SCHEDA INFORMATIVA COMMESSA (SOLA LETTURA PER CONSULTAZIONE) */}
      {infoModalCommessa && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-4xl w-full border border-gray-150 flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header Modale */}
            <div className="flex justify-between items-center shrink-0 border-b border-gray-100 p-6 pb-4 bg-white rounded-t-[2rem]">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl border border-blue-100">
                  <Briefcase className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900 tracking-tight">
                    Scheda Informativa Commessa
                  </h3>
                  <p className="text-xs text-gray-500 font-semibold">
                    Dettagli strutturali e progetti associati (Sola Lettura)
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setInfoModalCommessa(null)} 
                className="text-gray-400 hover:text-gray-600 p-2 rounded-xl hover:bg-gray-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body Modale Scrollabile Interno */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5">

              {/* Banner Nome e Codice Commessa */}
              <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-900 p-5 rounded-2xl text-white shadow-md">
                <div className="text-[10px] font-black uppercase tracking-wider text-blue-300 mb-1">
                  {infoModalCommessa.codiceCommessa || infoModalCommessa.codice || 'Commessa'} • {TIPOLOGIE_COMMESSE[infoModalCommessa.tipologia] || infoModalCommessa.tipologia || 'Tipologia N/D'}
                </div>
                <div className="font-black text-lg text-white leading-snug">
                  {infoModalCommessa.nome}
                </div>
                <div className="text-xs text-blue-200 mt-2 font-medium flex items-center gap-2">
                  <span>💼 Cliente: <strong>{infoModalCommessa.cliente || 'Non specificato'}</strong></span>
                </div>
              </div>

              {/* Griglia Dettagli Sola Lettura */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                {/* Card Responsabile & PM */}
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/70 space-y-3">
                  <div className="text-xs font-black text-slate-800 uppercase tracking-wide border-b border-slate-200 pb-2">
                    👤 Responsabile & Management
                  </div>
                  <div className="text-xs">
                    <span className="text-slate-500 font-medium">Responsabile:</span>
                    <div className="font-extrabold text-slate-900 text-sm mt-0.5">
                      {infoModalCommessa.responsabile || 'Non assegnato'}
                    </div>
                  </div>
                  <div className="text-xs pt-1 border-t border-slate-200/60">
                    <span className="text-slate-500 font-medium">Project Manager (PM):</span>
                    <div className="font-extrabold text-indigo-900 text-xs mt-1 flex flex-wrap gap-1">
                      {(() => {
                        const pmList = Array.isArray(infoModalCommessa.pm) ? infoModalCommessa.pm : (infoModalCommessa.pm ? [infoModalCommessa.pm] : []);
                        if (pmList.length === 0) return <span className="text-slate-400 italic font-normal">Nessun PM assegnato</span>;
                        return pmList.map((pm: string) => (
                          <span key={pm} className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-md font-bold">
                            {pm}
                          </span>
                        ));
                      })()}
                    </div>
                  </div>
                </div>

                {/* Card Stato & Date */}
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/70 space-y-3">
                  <div className="text-xs font-black text-slate-800 uppercase tracking-wide border-b border-slate-200 pb-2">
                    📅 Periodo & Stato
                  </div>
                  <div className="text-xs flex items-center justify-between">
                    <span className="text-slate-500 font-medium">Stato Commessa:</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black ${
                      infoModalCommessa.stato === 'Chiusa' ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    }`}>
                      {infoModalCommessa.stato || 'Aperta'}
                    </span>
                  </div>
                  <div className="text-xs pt-1 border-t border-slate-200/60 space-y-1">
                    <div>Data Inizio: <strong className="text-slate-800">{infoModalCommessa.dataInizio ? formatDate(infoModalCommessa.dataInizio) : 'N/D'}</strong></div>
                    <div>Data Fine: <strong className="text-slate-800">{infoModalCommessa.dataFine ? formatDate(infoModalCommessa.dataFine) : 'N/D'}</strong></div>
                  </div>
                </div>

                {/* Card Aperta Da / Info Sistema */}
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/70 space-y-3">
                  <div className="text-xs font-black text-slate-800 uppercase tracking-wide border-b border-slate-200 pb-2">
                    ℹ️ Informazioni Registrazione
                  </div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <div>Aperta da: <strong className="text-slate-800">{infoModalCommessa.apertaDa || 'N/D'}</strong></div>
                    <div>Anno Riferimento: <strong className="text-slate-800">{infoModalCommessa.anno || 'N/D'}</strong></div>
                    {infoModalCommessa.dataApertura && (
                      <div>Data Apertura: <strong className="text-emerald-800">{new Date(infoModalCommessa.dataApertura).toLocaleDateString('it-IT')}</strong></div>
                    )}
                  </div>
                </div>

              </div>

              {/* Card Percorso Cartella di Rete Commessa */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/70 space-y-2">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <div className="text-xs font-black text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                    <Folder className="w-4 h-4 text-indigo-600" />
                    <span>Cartella di Rete (File System)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCommessaForNetworkPath(infoModalCommessa);
                      setNetworkPathInput(infoModalCommessa.percorsoRete || '');
                      setIsNetworkPathModalOpen(true);
                    }}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                    <span>{infoModalCommessa.percorsoRete ? 'Modifica' : 'Imposta percorso'}</span>
                  </button>
                </div>
                {infoModalCommessa.percorsoRete ? (
                  <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
                    <span className="font-mono text-xs text-slate-800 break-all select-all font-semibold">
                      {infoModalCommessa.percorsoRete}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleOpenNetworkPath(infoModalCommessa)}
                      className="shrink-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg shadow-xs transition flex items-center gap-1.5 cursor-pointer active:scale-95"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Apri / Copia</span>
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">
                    Nessun percorso di rete collegato a questa commessa.
                  </p>
                )}
              </div>

              {/* Sezione Dettaglio Progetti & SGQ (Sola Lettura) */}
              <div className="bg-gradient-to-br from-indigo-50/40 to-slate-50 p-5 rounded-2xl border border-indigo-100/70 space-y-3">
                <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wide flex items-center gap-1.5 border-b border-indigo-100 pb-2">
                  🔀 Dettaglio Progetti & Utenti Abilitati
                </h4>

                <div className="space-y-3">
                  {(!Array.isArray(infoModalCommessa.progetti) || infoModalCommessa.progetti.length === 0) ? (
                    <p className="text-xs text-slate-400 italic">Nessun dettaglio progetto specificato per questa commessa.</p>
                  ) : (
                    infoModalCommessa.progetti.map((progetto: any, idx: number) => {
                      const utenti = progetto.utentiDaAbilitare || progetto.utentiAbilitati || [];
                      const verificatori = progetto.verificatori || [];

                      return (
                        <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs space-y-2.5">
                          <div className="font-extrabold text-slate-900 text-xs sm:text-sm">
                            {progetto.descrizione || '(Nessuna descrizione)'}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs pt-2 border-t border-slate-100">
                            <div>
                              <span className="text-slate-400 text-[10px] font-bold uppercase block">Project Manager</span>
                              <span className="font-bold text-slate-800">{progetto.pm || 'Non assegnato'}</span>
                            </div>

                            <div>
                              <span className="text-slate-400 text-[10px] font-bold uppercase block">Abilitazione SGQ</span>
                              <span className={`font-black ${progetto.sgq === 'SI' ? 'text-indigo-700' : 'text-slate-600'}`}>
                                {progetto.sgq === 'SI' ? '✓ SI (SGQ Abilitato)' : 'NO'}
                              </span>
                            </div>

                            <div>
                              <span className="text-slate-400 text-[10px] font-bold uppercase block">Giornate Stimate</span>
                              <span className="font-bold text-slate-700">
                                Senior: {progetto.giornateSenior || 0} gg | Project: {progetto.giornateProject || 0} gg | Junior: {progetto.giornateJunior || 0} gg
                              </span>
                            </div>
                          </div>

                          {utenti.length > 0 && (
                            <div className="pt-2 border-t border-slate-100">
                              <span className="text-[10px] font-bold text-emerald-800 uppercase block mb-1">Utenti Abilitati sul Progetto</span>
                              <div className="flex flex-wrap gap-1">
                                {utenti.map((u: string) => (
                                  <span key={u} className="bg-emerald-50 text-emerald-800 border border-emerald-200/80 px-2 py-0.5 rounded-md text-[10px] font-bold">
                                    {u}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {progetto.sgq === 'SI' && verificatori.length > 0 && (
                            <div className="pt-1">
                              <span className="text-[10px] font-bold text-indigo-800 uppercase block mb-1">Verificatori / Validatori SGQ</span>
                              <div className="flex flex-wrap gap-1">
                                {verificatori.map((v: string) => (
                                  <span key={v} className="bg-indigo-50 text-indigo-800 border border-indigo-200/80 px-2 py-0.5 rounded-md text-[10px] font-bold">
                                    {v}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>

            {/* Footer Modale: Solo Chiudi (Fisso in basso) */}
            <div className="flex justify-end items-center p-6 pt-4 border-t border-gray-150 bg-white rounded-b-[2rem] shrink-0">
              <button 
                type="button" 
                onClick={() => setInfoModalCommessa(null)} 
                className="py-2.5 px-6 rounded-xl bg-gray-800 hover:bg-gray-900 text-white text-xs font-extrabold transition cursor-pointer"
              >
                Chiudi
              </button>
            </div>

          </div>
        </div>
      )}

      {/* TAB 3: ALTRE COMMESSE - RICHIESTA PER COORDINATORI */}
      {(activeTab === 'altre-commesse' && canAccessAltreCommesseTab) && (
        <div className="space-y-8">
          <section className="bg-gradient-to-br from-amber-50 via-orange-50/40 to-slate-50 p-6 sm:p-8 rounded-3xl border border-amber-200/80 shadow-sm">
            <div className="flex items-center gap-3 border-b border-amber-200/80 pb-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center font-black text-xl shadow-md shrink-0">
                ✉️
              </div>
              <div>
                <h3 className="text-xl font-extrabold text-amber-950">Richiesta Inserimento su Altre Commesse Aperte</h3>
                <p className="text-xs text-amber-800 font-semibold mt-0.5">
                  Seleziona dal menu a tendina la commessa gestita da altri responsabili su cui desideri inserire personale e compila i dettagli di richiesta.
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmitRequest} className="bg-white p-6 sm:p-8 rounded-2xl border border-amber-200/80 shadow-sm space-y-6">
              
              {/* SELETTORE COMMESSA RICERCABILE */}
              <div className="space-y-2">
                <label className="block text-xs font-black uppercase text-amber-950 tracking-wider">
                  1. Cerca e Seleziona Commessa Aperta dal Menu a Tendina *
                </label>
                
                <div className="relative">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Cerca per nome commessa, cliente, codice o responsabile..."
                      value={isAltreCommessaDropdownOpen ? altreCommessaSearchText : (selectedAltreCommessa ? selectedAltreCommessa.nome : altreCommessaSearchText)}
                      onChange={e => {
                        setAltreCommessaSearchText(e.target.value);
                        setIsAltreCommessaDropdownOpen(true);
                      }}
                      onFocus={() => {
                        setAltreCommessaSearchText('');
                        setIsAltreCommessaDropdownOpen(true);
                      }}
                      className="w-full p-4 pr-10 border border-amber-300 rounded-xl bg-amber-50/20 font-extrabold text-xs text-gray-850 outline-none focus:ring-2 focus:ring-amber-500 shadow-inner cursor-pointer"
                    />
                    <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                      <ChevronDown className="w-4 h-4" />
                    </div>
                  </div>

                  {/* MENU A TENDINA CON RISULTATI DELLA RICERCA */}
                  {isAltreCommessaDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setIsAltreCommessaDropdownOpen(false)}></div>
                      <div className="absolute left-0 right-0 z-20 mt-1.5 bg-white border border-amber-300 rounded-xl shadow-2xl overflow-hidden">
                        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 p-1">
                          {(() => {
                            const query = altreCommessaSearchText.toLowerCase().trim();
                            const availableCommesse = commesse.filter(c => (!c.stato || c.stato !== 'Chiusa') && !isUserPmOrRespOfCommessa(c));
                            const filtered = availableCommesse.filter(c => {
                              if (!query) return true;
                              const name = (c.nome || '').toLowerCase();
                              const client = (c.cliente || '').toLowerCase();
                              const resp = (c.responsabile || '').toLowerCase();
                              const codice = (c.codiceCommessa || '').toLowerCase();
                              return name.includes(query) || client.includes(query) || resp.includes(query) || codice.includes(query);
                            });

                            if (filtered.length === 0) {
                              return (
                                <div className="p-4 text-xs text-gray-400 italic text-center">
                                  Nessuna commessa aperta trovata per "{altreCommessaSearchText}".
                                </div>
                              );
                            }

                            return filtered.map(c => {
                              const respName = c.responsabile || 'Non assegnato';
                              const pmStr = Array.isArray(c.pm) ? c.pm.join(', ') : (c.pm || '');
                              const isSelected = selectedAltreCommessa?.id === c.id;
                              return (
                                <div
                                  key={c.id}
                                  ref={el => {
                                    if (el && isSelected && el.parentElement) {
                                      el.parentElement.scrollTop = el.offsetTop;
                                    }
                                  }}
                                  onClick={() => {
                                    setSelectedAltreCommessa(c);
                                    setAltreCommessaSearchText(c.nome);
                                    setReqCommessaId(c.id);
                                    const myDipObj = dipendenti.find(d => d.email && d.email.toLowerCase() === userEmail.toLowerCase()) || dipendenti.find(d => areNamesEqual(d.nome, myAssociatedName));
                                    const targetDefaultArea = myCoordinatedAreas.length > 0 ? myCoordinatedAreas[0] : (myDipObj?.macroArea || 'Disegnatori');
                                    setReqAreaTarget(targetDefaultArea);
                                    setReqPreferredResource(myAssociatedName || myDipObj?.nome || '');
                                    setIsAltreCommessaDropdownOpen(false);
                                  }}
                                  className={`p-3.5 cursor-pointer transition flex items-center justify-between gap-3 text-xs rounded-lg ${
                                    isSelected ? 'bg-amber-100/90 font-black text-amber-950' : 'hover:bg-amber-50'
                                  }`}
                                >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span className="w-3 h-3 rounded-full shrink-0 shadow-2xs" style={{ backgroundColor: c.colore || '#6366f1' }}></span>
                                  <div className="flex flex-col truncate">
                                    <span className="font-bold text-gray-900 truncate">
                                      {isSelected ? '✓ ' : ''}{c.nome}
                                    </span>
                                    <span className="text-[10px] text-gray-500">Cliente: {c.cliente || '-'}</span>
                                  </div>
                                </div>
                                <span className="font-extrabold text-[10.5px] text-amber-900 bg-amber-100/80 px-2 py-0.5 rounded-md shrink-0">
                                  👤 Resp: {respName} {pmStr ? `(PM: ${pmStr})` : ''}
                                </span>
                              </div>
                            );
                          });
                        })()}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* ANTEPRIMA DETTAGLI COMMESSA SELEZIONATA */}
                {selectedAltreCommessa && (
                  <div className="mt-3 bg-amber-50/70 p-4 rounded-xl border border-amber-200/80 flex items-center justify-between flex-wrap gap-3 text-xs animate-in fade-in duration-150">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedAltreCommessa.colore || '#6366f1' }}></span>
                      <strong className="text-gray-900">{selectedAltreCommessa.nome}</strong>
                    </div>
                    <div className="flex gap-4 text-gray-600 flex-wrap">
                      <span>Cliente: <strong className="text-gray-800">{selectedAltreCommessa.cliente || '-'}</strong></span>
                      <span>Responsabile: <strong className="text-amber-900">{selectedAltreCommessa.responsabile || '-'}</strong></span>
                      {selectedAltreCommessa.pm && (
                        <span>PM: <strong className="text-gray-800">{Array.isArray(selectedAltreCommessa.pm) ? selectedAltreCommessa.pm.join(', ') : selectedAltreCommessa.pm}</strong></span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* SEZIONE CONFIGURAZIONE DETTAGLI RICHIESTA */}
              <div className="border-t border-gray-100 pt-5">
                <label className="block text-xs font-black uppercase text-amber-950 tracking-wider mb-4">
                  2. Dettagli della Richiesta
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* COLONNA SINISTRA */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Risorsa da Inserire (Precompilata con il tuo nome) *</label>
                      <select
                        required
                        value={reqPreferredResource}
                        onChange={e => setReqPreferredResource(e.target.value)}
                        className="w-full p-3 border border-gray-200 bg-slate-50 focus:bg-white rounded-xl text-xs font-extrabold text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 shadow-xs cursor-pointer"
                      >
                        <option value="">-- Seleziona Risorsa dell'Area --</option>
                        {myAssociatedName && <option value={myAssociatedName}>👤 Me stesso ({myAssociatedName})</option>}
                        {dipendenti
                          .filter(d => !isSoci(d.nome) && d.macroArea === reqAreaTarget && d.nome !== myAssociatedName)
                          .map(d => (
                            <option key={d.id} value={d.nome}>{d.nome}</option>
                          ))
                        }
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Area di Riferimento *</label>
                      <select
                        required
                        value={reqAreaTarget}
                        disabled={myCoordinatedAreas.length <= 1}
                        onChange={e => {
                          setReqAreaTarget(e.target.value);
                          setReqPreferredResource('');
                        }}
                        className="w-full p-3 border border-gray-200 bg-slate-50 focus:bg-white rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 shadow-xs cursor-pointer disabled:opacity-85 disabled:bg-gray-100"
                      >
                        {myCoordinatedAreas.length > 0 ? (
                          myCoordinatedAreas.map(area => (
                            <option key={area} value={area}>{area}</option>
                          ))
                        ) : (
                          <option value={reqAreaTarget}>{reqAreaTarget}</option>
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Percentuale Carico Richiesta *</label>
                      <select
                        required
                        value={reqPercentuale}
                        onChange={e => setReqPercentuale(Number(e.target.value))}
                        className="w-full p-3 border border-gray-200 bg-slate-50 focus:bg-white rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 shadow-xs cursor-pointer"
                      >
                        {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                          <option key={pct} value={pct}>{pct}%</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* COLONNA DESTRA */}
                  <div className="space-y-4 flex flex-col justify-between">
                    {/* SELEZIONE DA CALENDARIO DATE CON EVIDENZA SETTIMANA */}
                    {(() => {
                      const startOpt = selectableWeekOptions.find(o => o.mondayStr === reqDataInizio) || selectableWeekOptions[0];
                      const endOpt = selectableWeekOptions.find(o => o.sundayStr === reqDataFine) || startOpt;
                      const targetWeekIds = (reqDataInizio && reqDataFine) ? getWeeksSpannedByDates(reqDataInizio, reqDataFine) : [];

                      return (
                        <div className="bg-white/90 p-4 rounded-2xl border border-indigo-100 shadow-xs space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-wider mb-1.5 ml-0.5">
                                📅 DATA INIZIO (SCEGLI DA CALENDARIO)
                              </label>
                              <input
                                type="date"
                                value={reqDataInizio || startOpt?.mondayStr || ''}
                                onChange={e => handleReqDateInputChange(e.target.value, true)}
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
                                📅 DATA FINE (SCEGLI DA CALENDARIO)
                              </label>
                              <input
                                type="date"
                                min={reqDataInizio || undefined}
                                value={reqDataFine || endOpt?.sundayStr || ''}
                                onChange={e => handleReqDateInputChange(e.target.value, false)}
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
                            <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-50/80 px-3 py-2 rounded-xl border border-indigo-100 text-xs font-bold text-indigo-900">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
                                <span>
                                  Durata Selezionata: <strong className="text-indigo-700 font-extrabold">{targetWeekIds.length} {targetWeekIds.length === 1 ? 'settimana' : 'settimane'}</strong>
                                </span>
                              </div>
                              <span className="text-[11px] text-indigo-600/80 font-semibold">
                                (da Lun {formatDate(reqDataInizio || startOpt.mondayStr)} a Dom {formatDate(reqDataFine || endOpt.sundayStr)})
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    <div>
                      <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1 flex items-center justify-between">
                        <span>Nota per il Responsabile di Commessa</span>
                        <span className="text-[10px] text-gray-400 font-semibold italic">(Facoltativa)</span>
                      </label>
                      <textarea
                        placeholder="Es. Inserimento per supporto alla progettazione..."
                        value={reqNota}
                        onChange={e => setReqNota(e.target.value)}
                        rows={3}
                        className="w-full p-3 border border-gray-200 bg-slate-50 focus:bg-white rounded-xl text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 shadow-inner resize-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* PULSANTE INVIA RICHIESTA */}
              <div className="flex justify-end pt-4 border-t border-gray-100">
                <button
                  type="submit"
                  disabled={isSubmittingRequest || !reqCommessaId}
                  className="px-8 py-4 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-extrabold text-xs rounded-xl shadow-md hover:shadow-lg transition active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  <span>{isSubmittingRequest ? 'Invio in corso...' : '✉️ Invia Richiesta al Responsabile'}</span>
                </button>
              </div>

            </form>
          </section>
        </div>
      )}

      {/* MODALE RICHIESTA PERSONALE / MODIFICA ASSEGNAZIONE DIPENDENTE */}
      {isRequestModalOpen && (() => {
        const areaModalColors: Record<string, { gradient: string; titleColor: string; subtitleColor: string; ring: string }> = {
          'Disegnatori':          { gradient: 'from-teal-50/50 to-slate-50',   titleColor: 'text-teal-950',   subtitleColor: 'text-teal-700/80',   ring: 'focus:ring-teal-500' },
          'Ingegneria':           { gradient: 'from-indigo-50/50 to-slate-50', titleColor: 'text-indigo-950', subtitleColor: 'text-indigo-700/80', ring: 'focus:ring-indigo-500' },
          'Sicurezza Cantieri':   { gradient: 'from-emerald-50/50 to-slate-50',titleColor: 'text-emerald-950',subtitleColor: 'text-emerald-700/80',ring: 'focus:ring-emerald-500' },
          'Consulenza Sicurezza': { gradient: 'from-amber-50/50 to-slate-50',  titleColor: 'text-amber-950',  subtitleColor: 'text-amber-700/80',  ring: 'focus:ring-amber-500' },
          'Amministrazione':      { gradient: 'from-blue-50/50 to-slate-50',   titleColor: 'text-blue-950',   subtitleColor: 'text-blue-700/80',   ring: 'focus:ring-blue-500' },
        };
        const mc = areaModalColors[reqAreaTarget] || areaModalColors['Disegnatori'];
        const commObj = commesse.find(c => c.id === reqCommessaId);

        return (
          <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center z-[9999] p-4 sm:p-6 no-print animate-in fade-in duration-200">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-3xl border border-gray-100 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
              <div className={`p-6 sm:p-8 border-b flex justify-between items-center bg-gradient-to-br ${mc.gradient} rounded-t-[2rem]`}>
                <div>
                  <h3 className={`text-xl font-extrabold ${mc.titleColor}`}>
                    {isSelfChangeRequest ? "Richiesta Modifica Assegnazione" : `Richiedi Personale — ${reqAreaTarget}`}
                  </h3>
                  <p className={`text-xs ${mc.subtitleColor} mt-1`}>
                    {isSelfChangeRequest 
                      ? "Invia una richiesta ai coordinatori e al responsabile per modificare la tua assegnazione su questa commessa." 
                      : `Invia una richiesta ai coordinatori dell'area ${reqAreaTarget}.`}
                  </p>
                </div>
                <button 
                  type="button"
                  onClick={() => {
                    setIsRequestModalOpen(false);
                    setIsSelfChangeRequest(false);
                  }}
                  className="text-gray-400 hover:text-gray-650 text-lg font-bold p-2 hover:bg-gray-100 rounded-full transition cursor-pointer"
                >
                  ✕
                </button>
              </div>
              
              <form onSubmit={handleSubmitRequest} className="p-6 sm:p-8 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Colonna Sinistra */}
                  <div className="space-y-4">
                    {isSelfChangeRequest ? (
                      <>
                        {/* Sezione Sola Lettura per Dipendente Standard */}
                        <div>
                          <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Area di Riferimento</label>
                          <div className="w-full p-2.5 bg-slate-100/90 rounded-xl text-xs font-bold text-gray-700 flex items-center gap-2 border border-slate-200/60 shadow-inner">
                            <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                            <span>{reqAreaTarget}</span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Commessa Assegnata</label>
                          <div className="w-full p-2.5 bg-slate-100/90 rounded-xl text-xs font-bold text-gray-800 border border-slate-200/60 shadow-inner">
                            {commObj ? `${commObj.nome} [${commObj.codiceCommessa || commObj.id}]` : reqCommessaId}
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Risorsa</label>
                          <div className="w-full p-2.5 bg-slate-100/90 rounded-xl text-xs font-bold text-indigo-900 flex items-center gap-1.5 border border-slate-200/60 shadow-inner">
                            <User className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            <span className="truncate">{myAssociatedName || reqPreferredResource}</span>
                            <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-black uppercase ml-auto shrink-0">Tu</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Sezione Modificabile per PM / Coordinatori */}
                        <div>
                          <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Area Richiesta *</label>
                          <select
                            required
                            value={reqAreaTarget}
                            onChange={e => {
                              setReqAreaTarget(e.target.value);
                              setReqPreferredResource('');
                            }}
                            className={`w-full p-2.5 border-none bg-slate-50 focus:bg-white rounded-xl text-xs font-bold text-gray-750 outline-none focus:ring-2 ${mc.ring} shadow-inner cursor-pointer`}
                          >
                            <option value="Disegnatori">Disegnatori</option>
                            <option value="Ingegneria">Ingegneria</option>
                            <option value="Sicurezza Cantieri">Sicurezza Cantieri</option>
                            <option value="Consulenza Sicurezza">Consulenza Sicurezza</option>
                            <option value="Amministrazione">Amministrazione</option>
                          </select>
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
                            {selectableCommesseForRequest.map(c => (
                              <option key={c.id} value={c.id}>{c.nome} [{c.codiceCommessa || c.id}]</option>
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
                      </>
                    )}

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
                      const startOpt = selectableWeekOptions.find(o => o.mondayStr === reqDataInizio) || selectableWeekOptions[0];
                      const endOpt = selectableWeekOptions.find(o => o.sundayStr === reqDataFine) || startOpt;
                      const targetWeekIds = (reqDataInizio && reqDataFine) ? getWeeksSpannedByDates(reqDataInizio, reqDataFine) : [];

                      return (
                        <div className="bg-white/90 p-4 rounded-2xl border border-indigo-100 shadow-xs space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-wider mb-1.5 ml-0.5">
                                📅 DATA INIZIO (SCEGLI DA CALENDARIO)
                              </label>
                              <input
                                type="date"
                                value={reqDataInizio || startOpt?.mondayStr || ''}
                                onChange={e => handleReqDateInputChange(e.target.value, true)}
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
                                min={reqDataInizio || undefined}
                                value={reqDataFine || endOpt?.sundayStr || ''}
                                onChange={e => handleReqDateInputChange(e.target.value, false)}
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
                                (da Lun {formatDate(reqDataInizio || startOpt.mondayStr)} a Dom {formatDate(reqDataFine || endOpt.sundayStr)})
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    <div>
                      <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1 flex items-center justify-between">
                        <span>{isSelfChangeRequest ? "Motivazione / Nota per Coordinatore e PM" : "Nota per il Coordinatore"}</span>
                        <span className="text-[10px] text-gray-400 font-semibold italic">(Facoltativa)</span>
                      </label>
                      <textarea
                        placeholder={isSelfChangeRequest ? "Es. Richiedo variazione percentuale o spostamento per..." : `Es. Ho bisogno di una risorsa dell'area ${reqAreaTarget} con esperienza in...`}
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
                    onClick={() => {
                      setIsRequestModalOpen(false);
                      setIsSelfChangeRequest(false);
                    }}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-extrabold py-3 rounded-xl transition active:scale-95 text-xs text-center cursor-pointer"
                  >
                    Chiudi
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingRequest}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-3 rounded-xl shadow-md transition active:scale-95 text-xs text-center disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmittingRequest ? "Invio in corso..." : (isSelfChangeRequest ? "Invia Richiesta Modifica" : `Invia Richiesta ${reqAreaTarget}`)}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      <PianificazioneModal
        isOpen={planningModal.isOpen}
        onClose={() => setPlanningModal(prev => ({ ...prev, isOpen: false }))}
        initialTab={planningModal.tab}
        initialCommessaId={planningModal.commessaId}
        initialResourceName={planningModal.risorsa}
        initialWeekId={planningModal.weekId}
        onRequestAreaResource={(macroArea, commId, wkId, personName) => {
          setPlanningModal(prev => ({ ...prev, isOpen: false }));
          const targetArea = macroArea || 'Disegnatori';
          const weekRange = getWeekDateRange(wkId);
          setReqAreaTarget(targetArea);
          setReqCommessaId(commId);
          setReqPreferredResource(personName && dipendenti.some(d => d.nome === personName) ? personName : '');
          setReqPercentuale(100);
          setReqDataInizio(weekRange.startStr);
          setReqDataFine(weekRange.endStr);
          setReqNota('');
          setIsRequestModalOpen(true);
        }}
      />

      <ResourceAvailabilityModal
        isOpen={isAvailabilityModalOpen}
        onClose={() => setIsAvailabilityModalOpen(false)}
      />

      {/* MODALE DI POPUP: NUOVO CLIENTE */}
      {isNewClientModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-blue-50/90 backdrop-blur-2xl rounded-3xl p-6 sm:p-7 shadow-2xl max-w-md w-full border border-blue-100/80 animate-in zoom-in-95 duration-200">
            
            {/* Header Modale */}
            <div className="flex justify-between items-start mb-5">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 text-blue-600 rounded-2xl shadow-xs">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-blue-950">Nuovo Cliente</h3>
                  <p className="text-xs text-gray-500 font-medium">Aggiungi un nuovo cliente all'anagrafica aziendale.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewClientModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-white/60 rounded-xl transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNewClientQuickly} className="space-y-5">
              {/* Codice Cliente Progressivo (Disabilitato e Centrato) */}
              <div>
                <label className="block text-[10px] font-extrabold text-blue-950 uppercase tracking-wide mb-1.5 ml-1">Codice Cliente (Progressivo)</label>
                <div className="w-full p-3 rounded-2xl bg-gray-100/80 text-gray-700 font-black text-sm text-center border border-gray-200/60 shadow-inner select-none">
                  {nextProgressiveClientCode}
                </div>
              </div>

              {/* Ragione Sociale Input */}
              <div>
                <label className="block text-[10px] font-extrabold text-blue-950 uppercase tracking-wide mb-1.5 ml-1">Ragione Sociale</label>
                <input
                  autoFocus
                  required
                  type="text"
                  placeholder="Es. Borgo della Val di Cornia S.r.l."
                  value={newClientNome}
                  onChange={e => setNewClientNome(e.target.value)}
                  className="w-full p-3 border-none rounded-2xl bg-white shadow-sm focus:ring-2 focus:ring-blue-400 outline-none font-semibold text-gray-800 text-xs"
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSavingNewClient}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-2xl font-extrabold text-xs shadow-md shadow-blue-300/50 transition active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSavingNewClient ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>+ Aggiungi Cliente</span>
                  </>
                )}
              </button>
            </form>

          </div>
        </div>
      )}

      {/* MODALE DI GESTIONE PERCORSO CARTELLA DI RETE */}
      {isNetworkPathModalOpen && selectedCommessaForNetworkPath && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-7 shadow-2xl max-w-lg w-full border border-gray-150 animate-in zoom-in-95 duration-200">
            
            {/* Header Modale */}
            <div className="flex justify-between items-start mb-5">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-indigo-100 text-indigo-700 rounded-2xl shadow-xs">
                  <Folder className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900">Cartella di Rete Commessa</h3>
                  <p className="text-xs text-gray-500 font-medium truncate max-w-xs sm:max-w-sm">
                    {selectedCommessaForNetworkPath.nome}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsNetworkPathModalOpen(false);
                  setSelectedCommessaForNetworkPath(null);
                }}
                className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-gray-100 rounded-xl transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNetworkPath} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-800 mb-1 ml-0.5">
                  Percorso di rete (Cartella UNC o locale)
                </label>
                <div className="relative">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Es. \\srvapp\home\dati\01_Archivio\185_Takeda\..."
                    value={networkPathInput}
                    onChange={e => setNetworkPathInput(e.target.value)}
                    className="w-full p-3 pr-24 border border-gray-200 rounded-xl text-xs font-mono text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner bg-slate-50 focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        if (text) setNetworkPathInput(text.trim());
                      } catch {
                        showToast("Incolla manualmente il percorso con Ctrl+V.", "warning");
                      }
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 transition cursor-pointer"
                    title="Incolla dagli appunti"
                  >
                    Incolla
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed font-medium">
                  Inserisci il percorso della cartella su disco di rete (es. <code className="text-[10px] bg-gray-100 px-1 py-0.5 rounded text-gray-700">\\srvapp\home\dati\...</code>). Cliccando sul pulsante nella tabella, il percorso verrà aperto in Esplora Risorse e copiato negli appunti.
                </p>
              </div>

              {/* Bottoni di azione */}
              <div className="flex gap-2.5 pt-2">
                {selectedCommessaForNetworkPath.percorsoRete && (
                  <button
                    type="button"
                    disabled={isSavingNetworkPath}
                    onClick={() => {
                      setConfirmConfig({
                        isOpen: true,
                        title: "Rimuovi Percorso di Rete",
                        message: `Vuoi rimuovere il collegamento alla cartella di rete per la commessa "${selectedCommessaForNetworkPath.nome}"?`,
                        type: "warning",
                        onConfirm: async () => {
                          setIsSavingNetworkPath(true);
                          const commId = selectedCommessaForNetworkPath.id;
                          try {
                            await updateDoc(doc(db, 'catalogo_commesse', commId), {
                              percorsoRete: ''
                            });
                            selectedCommessaForNetworkPath.percorsoRete = '';
                            const targetInList = commesse.find(c => c.id === commId);
                            if (targetInList) {
                              targetInList.percorsoRete = '';
                            }
                            if (infoModalCommessa && infoModalCommessa.id === commId) {
                              setInfoModalCommessa({ ...infoModalCommessa, percorsoRete: '' });
                            }
                            showToast("Percorso di rete rimosso.", "success");
                            setIsNetworkPathModalOpen(false);
                            setSelectedCommessaForNetworkPath(null);
                            if (loadPlanningData) await loadPlanningData();
                            if (refreshData) await refreshData();
                          } catch (err: any) {
                            showToast("Errore: " + err.message, "error");
                          } finally {
                            setIsSavingNetworkPath(false);
                            setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                          }
                        }
                      });
                    }}
                    className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl border border-rose-200 transition cursor-pointer"
                  >
                    Rimuovi
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setIsNetworkPathModalOpen(false);
                    setSelectedCommessaForNetworkPath(null);
                  }}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2.5 rounded-xl transition text-xs cursor-pointer text-center"
                >
                  Annulla
                </button>

                <button
                  type="submit"
                  disabled={isSavingNetworkPath}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-2.5 rounded-xl shadow-md transition active:scale-95 text-xs cursor-pointer text-center disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {isSavingNetworkPath ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <span>Salva Percorso</span>
                  )}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* MODALE TO-DO LIST COMMESSA */}
      {isPunchListModalOpen && selectedCommessaForPunchList && (() => {
        const canAdd = canUserAddToPunchList(selectedCommessaForPunchList);
        const allTasks: PunchListItem[] = selectedCommessaForPunchList.punchList || [];
        const eligibleAssignees = getEligibleAssigneesForCommessa(selectedCommessaForPunchList, editingTask?.assegnatoA);
        
        const isDone = (t: PunchListItem) => t.stato === 'completato' || t.stato === 'eseguito';
        const countTotal = allTasks.length;
        const countDone = allTasks.filter(isDone).length;
        const countTodo = allTasks.filter(t => t.stato === 'da_fare').length;

        const filteredTasks = allTasks.filter(t => {
          if (punchListFilter === 'da_fare') return t.stato === 'da_fare';
          if (punchListFilter === 'completato') return isDone(t);
          return true;
        }).sort((a, b) => {
          // Ordinamento prioritario: prima 'da_fare' (score 1), poi 'completato' (score 2)
          const scoreA = isDone(a) ? 2 : 1;
          const scoreB = isDone(b) ? 2 : 1;
          if (scoreA !== scoreB) {
            return scoreA - scoreB;
          }
          // Per 'da_fare', ordina per data di scadenza (le più vicine per prime)
          if (a.scadenza && b.scadenza) return a.scadenza.localeCompare(b.scadenza);
          if (a.scadenza) return -1;
          if (b.scadenza) return 1;
          return (b.creatoIl || '').localeCompare(a.creatoIl || '');
        });

        const isTodayOrPast = (dStr?: string) => {
          if (!dStr) return false;
          const today = new Date().toLocaleDateString('sv-SE');
          return dStr < today;
        };

        const curCatConfig = (newTaskCategoria && CATEGORIA_CONFIG[newTaskCategoria]) ? CATEGORIA_CONFIG[newTaskCategoria] : {
          label: newTaskCategoria || 'Generale',
          icon: '📌',
          bg: 'bg-gray-50',
          text: 'text-gray-700',
          border: 'border-gray-200'
        };

        return (
          <div className="fixed inset-0 bg-slate-900/70 z-[9999] flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-5xl w-full border border-gray-150 flex flex-col max-h-[92vh] overflow-hidden">
              
              {/* Header Modale ToDo List */}
              <div className="p-5 sm:p-6 pb-4 border-b border-gray-150 bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-900 text-white rounded-t-3xl flex justify-between items-start shrink-0">
                <div className="space-y-1 min-w-0 flex-1 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 bg-white/10 rounded-xl">
                      <ListTodo className="w-5 h-5 text-indigo-300" />
                    </span>
                    <h3 className="text-lg font-black text-white tracking-tight truncate">
                      ToDo List
                    </h3>
                  </div>
                  <div className="text-xs text-indigo-200 font-bold truncate">
                    {selectedCommessaForPunchList.nome}
                  </div>
                  <div className="text-[11px] text-indigo-300/80 flex flex-wrap gap-x-3 gap-y-0.5 pt-1">
                    {selectedCommessaForPunchList.cliente && <span>💼 Cliente: <strong>{selectedCommessaForPunchList.cliente}</strong></span>}
                    {selectedCommessaForPunchList.responsabile && <span>👤 Resp: <strong>{getOfficialName(selectedCommessaForPunchList.responsabile)}</strong></span>}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsPunchListModalOpen(false);
                    setSelectedCommessaForPunchList(null);
                    setEditingTask(null);
                    setIsCatDropdownOpen(false);
                    setIsAssDropdownOpen(false);
                  }}
                  className="text-white/70 hover:text-white p-2 hover:bg-white/10 rounded-xl transition cursor-pointer shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form Inserimento / Modifica Voce ToDo (Fisso in alto per evitare layout shift o scrollbar indesiderate) */}
              {canAdd && (
                <div className="p-4 sm:px-6 bg-slate-50/80 border-b border-slate-200/90 shrink-0 relative z-30">
                  <form onSubmit={handleAddOrEditPunchTask} className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
                        <span>{editingTask ? '✏️ Modifica Voce ToDo List' : '➕ Nuovo Punto ToDo List'}</span>
                      </span>
                      {editingTask && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTask(null);
                            setNewTaskTitolo('');
                            setNewTaskDescrizione('');
                            setNewTaskScadenza('');
                            setNewTaskAssegnatoA('');
                            setNewTaskCategoria(TODO_CATEGORIE[0] || 'aggiornare');
                            setIsCatDropdownOpen(false);
                            setIsAssDropdownOpen(false);
                          }}
                          className="text-[11px] font-bold text-gray-500 hover:text-gray-800 underline cursor-pointer"
                        >
                          Annulla Modifica
                        </button>
                      )}
                    </div>

                    {/* Riga 1: Categoria (Menu a 2 Colonne Concentrato & Tutto Visibile) + Descrizione/Titolo */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
                      <div className="md:col-span-4 relative" ref={catDropdownRef}>
                        <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block mb-0.5">
                           Categoria Attività *
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setIsCatDropdownOpen(!isCatDropdownOpen);
                            setIsAssDropdownOpen(false);
                          }}
                          className="w-full py-1.5 px-2.5 border border-slate-200 bg-white rounded-xl text-xs font-black text-gray-800 flex items-center justify-between gap-2 hover:border-indigo-400 focus:ring-2 focus:ring-indigo-500 transition-colors cursor-pointer shadow-2xs h-[38px]"
                        >
                          <div className="flex items-center gap-1.5 min-w-0 truncate">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black border ${curCatConfig.bg} ${curCatConfig.text} ${curCatConfig.border}`}>
                              <span>{curCatConfig.icon}</span>
                              <span className="uppercase">{curCatConfig.label}</span>
                            </span>
                          </div>
                          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-150 shrink-0 ${isCatDropdownOpen ? 'rotate-180 text-indigo-600' : ''}`} />
                        </button>

                        {isCatDropdownOpen && (
                          <div className="absolute top-full left-0 mt-1 w-[380px] sm:w-[420px] max-w-[90vw] bg-white rounded-2xl border border-gray-200 shadow-2xl z-50 p-2 grid grid-cols-2 gap-1 animate-in fade-in zoom-in-95 duration-150">
                            {TODO_CATEGORIE.map(cat => {
                              const cfg = CATEGORIA_CONFIG[cat] || { label: cat, icon: '📌', bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' };
                              const isSelected = newTaskCategoria === cat;
                              return (
                                <button
                                  key={cat}
                                  type="button"
                                  onClick={() => {
                                    setNewTaskCategoria(cat);
                                    setIsCatDropdownOpen(false);
                                  }}
                                  className={`p-1 px-2 rounded-lg text-left text-[11px] flex items-center justify-between gap-1 transition cursor-pointer ${
                                    isSelected ? 'bg-indigo-50 font-black text-indigo-900 border border-indigo-200' : 'hover:bg-gray-50 text-gray-700 border border-transparent'
                                  }`}
                                >
                                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9.5px] font-black border ${cfg.bg} ${cfg.text} ${cfg.border} truncate`}>
                                    <span>{cfg.icon}</span>
                                    <span className="uppercase truncate">{cfg.label}</span>
                                  </span>
                                  {isSelected && <Check className="w-3 h-3 text-indigo-600 shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="md:col-span-8">
                        <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block mb-0.5">
                          Descrizione del punto ToDo *
                        </label>
                        <input
                          required
                          type="text"
                          placeholder="es. Telefonare a Studio Tecnico per conferma misure, Inviare computo via mail..."
                          value={newTaskTitolo}
                          onChange={e => setNewTaskTitolo(e.target.value)}
                          className="w-full py-1.5 px-3 border border-slate-200 bg-white rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs h-[38px]"
                        />
                      </div>
                    </div>

                    {/* Riga 2: Risorsa Assegnata + Scadenza + Pulsante Salva */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
                      <div className="md:col-span-6 relative" ref={assDropdownRef}>
                        <label className="text-[10px] font-extrabold text-indigo-700 uppercase tracking-wider block mb-0.5">
                          👤 Assegna a (Pianificati / Resp / PM) *
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAssDropdownOpen(!isAssDropdownOpen);
                            setIsCatDropdownOpen(false);
                          }}
                          className={`w-full py-1.5 px-2.5 border bg-white rounded-xl text-xs font-black flex items-center justify-between gap-2 hover:border-indigo-400 focus:ring-2 focus:ring-indigo-500 transition-colors cursor-pointer shadow-2xs h-[38px] ${
                            newTaskAssegnatoA ? 'text-gray-900 border-indigo-200' : 'text-gray-400 border-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            {newTaskAssegnatoA ? (
                              <span className="inline-flex items-center gap-1.5 text-gray-900 font-black truncate">
                                <User className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                <span className="truncate">{newTaskAssegnatoA}</span>
                              </span>
                            ) : (
                              <span className="text-gray-400 font-semibold truncate text-[11px]">
                                {eligibleAssignees.length === 0 
                                  ? '-- Nessuna risorsa pianificata su questa commessa --' 
                                  : '-- Seleziona Risorsa Incaricata * --'}
                              </span>
                            )}
                          </div>
                          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-150 shrink-0 ${isAssDropdownOpen ? 'rotate-180 text-indigo-600' : ''}`} />
                        </button>

                        {isAssDropdownOpen && (
                          <div className="absolute top-full left-0 mt-1 w-full max-h-56 overflow-y-auto bg-white rounded-2xl border border-gray-200 shadow-2xl z-50 p-1.5 divide-y divide-gray-50 scrollbar-thin animate-in fade-in zoom-in-95 duration-150">
                            {eligibleAssignees.length === 0 ? (
                              <div className="p-3 text-center text-xs text-gray-400">
                                Nessuna risorsa pianificata trovata per questa commessa.
                              </div>
                            ) : (
                              eligibleAssignees.map(name => {
                                const isSelected = newTaskAssegnatoA === name;
                                return (
                                  <button
                                    key={name}
                                    type="button"
                                    onClick={() => {
                                      setNewTaskAssegnatoA(name);
                                      setIsAssDropdownOpen(false);
                                    }}
                                    className={`w-full py-2 px-3 rounded-lg text-left text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                                      isSelected ? 'bg-indigo-50 font-black text-indigo-900' : 'hover:bg-gray-50 text-gray-800 font-medium'
                                    }`}
                                  >
                                    <span className="truncate">{name}</span>
                                    {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>

                      <div className="md:col-span-4">
                        <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider block mb-0.5">
                          📅 Scadenza (Opzionale)
                        </label>
                        <input
                          type="date"
                          value={newTaskScadenza}
                          onChange={e => setNewTaskScadenza(e.target.value)}
                          className="w-full py-1.5 px-2.5 border border-slate-200 bg-white rounded-xl text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs cursor-pointer h-[38px]"
                          title="Data di scadenza (opzionale)"
                        />
                      </div>

                      <div className="md:col-span-2 flex justify-end">
                        <button
                          type="submit"
                          disabled={isSavingTask || !newTaskTitolo.trim() || !newTaskAssegnatoA.trim()}
                          className="w-full h-[38px] px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow-xs transition active:scale-95 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          {isSavingTask ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5" />
                              <span>{editingTask ? 'Salva' : 'Aggiungi'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              )}

              {/* Barra Filtri & Conteggi Voci */}
              <div className="bg-slate-100/70 px-6 py-2.5 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="text-xs font-bold text-gray-500 flex items-center gap-1.5">
                  <span>Totale Punti:</span>
                  <span className="px-2.5 py-0.5 rounded-lg bg-white border border-gray-200 font-black text-gray-800 text-xs">
                    {countTotal}
                  </span>
                  <span className="text-[11px] text-emerald-700 font-bold">
                    ({countDone} completati)
                  </span>
                </div>

                {/* Filtri Stato */}
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setPunchListFilter('all')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${punchListFilter === 'all' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'}`}
                  >
                    Tutte ({countTotal})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPunchListFilter('da_fare')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${punchListFilter === 'da_fare' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'}`}
                  >
                    Da Fare ({countTodo})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPunchListFilter('completato')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${punchListFilter === 'completato' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'}`}
                  >
                    Completate ({countDone})
                  </button>
                </div>
              </div>

              {/* Corpo Scrollabile con Lista Task (con scrollbar-gutter:stable per eliminare qualsiasi layout shift) */}
              <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-3 [scrollbar-gutter:stable]">

                {/* Lista Voci ToDo Compatta da Spuntare */}
                {filteredTasks.length === 0 ? (
                  <div className="p-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-400 text-xs">
                    Nessuna voce presente con i filtri selezionati.
                  </div>
                ) : (
                  <div className="divide-y divide-gray-150 border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-2xs">
                    {filteredTasks.map(task => {
                      const done = isDone(task);
                      const isExpired = !done && isTodayOrPast(task.scadenza);
                      const catConfig = CATEGORIA_CONFIG[task.categoria || 'da fare'] || CATEGORIA_CONFIG['da fare'];
                      const canToggle = canUserToggleTask(task, selectedCommessaForPunchList);
                      const canEditOrDelete = canUserEditOrDeleteTask(task, selectedCommessaForPunchList);

                      let rowBg = "hover:bg-slate-50/80";
                      if (done) rowBg = "bg-slate-50/40 hover:bg-slate-50/60";

                      return (
                        <div key={task.id} className={`p-3 px-3.5 flex items-center justify-between gap-3 transition-colors ${rowBg}`}>
                          
                          {/* A Sinistra: Checkbox Interattivo, Categoria e Titolo */}
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            
                            {/* 1. Casella non spuntata (Da Fare) -> Cliccando si completa */}
                            {!done && (
                              <button
                                type="button"
                                disabled={!canToggle}
                                onClick={() => handleChangeTaskStatus(task, 'completato')}
                                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition shrink-0 group ${
                                  canToggle
                                    ? 'border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 cursor-pointer'
                                    : 'border-slate-200 bg-slate-100/50 cursor-not-allowed opacity-60'
                                }`}
                                title={canToggle ? "Clicca per segnare l'attività come completata" : `Solo ${task.assegnatoA || 'la risorsa assegnata'} o i Coordinatori/PM possono completare questa attività`}
                              >
                                <Check className={`w-3 h-3 text-transparent ${canToggle ? 'group-hover:text-emerald-600' : ''} transition`} />
                              </button>
                            )}

                            {/* 2. Casella spuntata (Completato) -> Cliccando si toglie la spunta (torna a Da Fare) */}
                            {done && (
                              <button
                                type="button"
                                disabled={!canToggle}
                                onClick={() => handleChangeTaskStatus(task, 'da_fare')}
                                className={`w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 ${
                                  canToggle ? 'cursor-pointer hover:bg-rose-500 transition group' : 'cursor-default'
                                }`}
                                title={canToggle ? "Completato - Clicca per togliere la spunta e riaprire a 'Da Fare'" : "Completato"}
                              >
                                <Check className={`w-3.5 h-3.5 ${canToggle ? 'group-hover:hidden' : ''}`} />
                                {canToggle && <X className="w-3 h-3 hidden group-hover:block" />}
                              </button>
                            )}

                            {/* Dettagli Voce ToDo */}
                            <div className="min-w-0 flex-1 flex flex-col justify-center">
                              <div className="flex items-center gap-2 flex-wrap">
                                
                                {/* Badge Categoria */}
                                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black border flex items-center gap-1 shrink-0 ${catConfig.bg} ${catConfig.text} ${catConfig.border}`}>
                                  <span>{catConfig.icon}</span>
                                  <span>{catConfig.label}</span>
                                </span>

                                {/* Titolo / Descrizione */}
                                <span className={`text-xs ${done ? 'line-through text-gray-400 font-medium' : 'font-extrabold text-gray-900'}`}>
                                  {task.titolo}
                                </span>

                                {/* Badge Stato completato */}
                                {done && (
                                  <span className="px-1.5 py-0.2 rounded-md text-[9.5px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                    ✓ COMPLETATO
                                  </span>
                                )}

                                {/* Scadenza in Linea */}
                                {task.scadenza && (
                                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-md ${isExpired ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-gray-100 text-gray-600'}`}>
                                    📅 {formatDate(task.scadenza)} {isExpired && '⚠️'}
                                  </span>
                                )}

                                {/* Assegnatario in Linea (Obbligatorio) */}
                                {task.assegnatoA && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                                    👤 {task.assegnatoA}
                                  </span>
                                )}
                              </div>

                              {/* Dettagli Autore / Completamento */}
                              <div className="text-[10px] text-gray-400 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                                <span>✍️ Creato da: <strong>{task.creatoDa}</strong></span>
                                {task.completatoDa && <span className="text-emerald-800 font-bold">✓ Completato da: {task.completatoDa}</span>}
                              </div>
                            </div>

                          </div>

                          {/* A Destra: Modifica ed Elimina (riservati all'autore o Coordinatori/PM/Admin) */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {canEditOrDelete && (
                              <div className="flex items-center gap-0.5 ml-1 border-l border-gray-200 pl-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTask(task);
                                    setNewTaskTitolo(task.titolo);
                                    setNewTaskCategoria(task.categoria || 'da fare');
                                    setNewTaskDescrizione(task.descrizione || '');
                                    setNewTaskScadenza(task.scadenza || '');
                                    setNewTaskAssegnatoA(task.assegnatoA || '');
                                  }}
                                  className="text-gray-400 hover:text-indigo-600 p-1 rounded-md hover:bg-gray-100 transition cursor-pointer"
                                  title="Modifica punto"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePunchTask(task)}
                                  className="text-gray-400 hover:text-rose-600 p-1 rounded-md hover:bg-rose-50 transition cursor-pointer"
                                  title="Elimina punto"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}

                          </div>

                        </div>
                      );
                    })}
                  </div>
                )}

              </div>

              {/* Footer */}
              <div className="flex justify-end items-center p-4 border-t border-gray-150 bg-slate-50 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsPunchListModalOpen(false);
                    setSelectedCommessaForPunchList(null);
                    setEditingTask(null);
                  }}
                  className="px-5 py-2.5 bg-gray-800 hover:bg-gray-900 text-white font-extrabold text-xs rounded-xl transition cursor-pointer"
                >
                  Chiudi
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* MODALE "I MIEI TODO NELLE COMMESSE" */}
      {isMyTasksModalOpen && (
        <div className="fixed inset-0 bg-slate-900/70 z-[9999] flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-5xl w-full border border-gray-150 flex flex-col max-h-[92vh] overflow-hidden">
            
            {/* Header Modale */}
            <div className="p-5 sm:p-6 pb-4 border-b border-gray-150 bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-900 text-white rounded-t-3xl flex justify-between items-start shrink-0">
              <div className="space-y-1 min-w-0 flex-1 pr-3">
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-indigo-500/20 text-indigo-300 rounded-xl border border-indigo-500/30">
                    <ListTodo className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="text-lg font-black text-white tracking-tight flex items-center gap-2">
                      I Miei ToDo nelle Commesse
                    </h3>
                    <p className="text-xs text-indigo-200/90 font-medium">
                      Attività assegnate a <span className="font-bold text-white underline decoration-indigo-400">{myAssociatedName || 'te'}</span> &bull; Raggruppate per commessa e ordinate per scadenza
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border ${
                    totalMyPendingTasksCount > 0 
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' 
                      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  }`}>
                    {totalMyPendingTasksCount > 0 ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
                        {totalMyPendingTasksCount} {totalMyPendingTasksCount === 1 ? 'attività da completare' : 'attività da completare'}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        Nessuna attività in sospeso
                      </>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMyTasksModalOpen(false)}
                  className="p-2 text-indigo-200 hover:text-white hover:bg-white/10 rounded-xl transition cursor-pointer"
                  title="Chiudi"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Corpo Modale Scrollabile */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1 bg-slate-50/50 [scrollbar-gutter:stable]">
              {totalMyPendingTasksCount === 0 ? (
                <div className="bg-white rounded-2xl p-10 text-center border border-gray-200 shadow-sm max-w-lg mx-auto my-6 space-y-4">
                  <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto border border-emerald-100 shadow-inner">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-base font-black text-gray-800">Tutto completato! 🎉</h4>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      Non hai attività "Da Fare" assegnate a tuo nome nelle commesse attualmente aperte. Sei perfettamente in pari con i tuoi compiti.
                    </p>
                  </div>
                </div>
              ) : (
                myAssignedPendingTasks.map(group => {
                  const comm = group.commessa;
                  const respStr = comm.responsabile || '-';
                  const pmStr = Array.isArray(comm.pm) ? comm.pm.join(', ') : (comm.pm || '-');

                  return (
                    <div key={comm.id} className="bg-white rounded-2xl border border-gray-200/90 shadow-sm overflow-hidden transition hover:shadow-md">
                      {/* Intestazione Gruppo Commessa */}
                      <div className="px-5 py-3.5 bg-gradient-to-r from-gray-50 to-indigo-50/30 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span 
                            className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs border border-white"
                            style={{ backgroundColor: comm.colore || '#3b82f6' }}
                          />
                          <div>
                            <h4 className="text-sm font-black text-gray-900 tracking-tight flex items-center gap-1.5 truncate">
                              <span>{comm.codiceCommessa ? `${comm.codiceCommessa} - ` : ''}{comm.nome}</span>
                            </h4>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500 mt-0.5">
                              {comm.cliente && (
                                <span className="font-semibold text-gray-700">🏢 {comm.cliente}</span>
                              )}
                              <span>👤 Resp: <strong className="text-gray-700">{respStr}</strong></span>
                              {pmStr !== '-' && <span>PM: <strong className="text-gray-700">{pmStr}</strong></span>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] font-black px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg">
                            {group.tasks.length} {group.tasks.length === 1 ? 'compito' : 'compiti'}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleOpenCommessaToDoFromMyTasks(comm)}
                            className="flex items-center gap-1 text-[11px] font-bold text-gray-700 hover:text-indigo-600 bg-white hover:bg-gray-100 border border-gray-200 px-2.5 py-1 rounded-lg transition cursor-pointer shadow-2xs"
                            title="Apri la ToDo List completa di questa commessa"
                          >
                            <span>Apri ToDo</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {/* Lista dei Task per questa Commessa */}
                      <div className="p-4 space-y-2.5">
                        {group.tasks.map(task => {
                          const catConf = (task.categoria && CATEGORIA_CONFIG[task.categoria]) ? CATEGORIA_CONFIG[task.categoria] : {
                            label: task.categoria || 'Generale',
                            icon: '📋',
                            bg: 'bg-gray-50',
                            text: 'text-gray-700',
                            border: 'border-gray-200'
                          };
                          const scadStatus = getScadenzaStatus(task.scadenza);

                          return (
                            <div 
                              key={task.id}
                              className={`p-3.5 sm:p-4 rounded-2xl border transition-all flex items-start gap-3.5 bg-white hover:bg-indigo-50/20 shadow-2xs ${scadStatus?.cardBorderClass || 'border-gray-200'}`}
                            >
                              {/* Spunta rapida */}
                              <button
                                type="button"
                                onClick={() => handleChangeTaskStatus(task, 'completato', comm)}
                                className="mt-0.5 w-6 h-6 rounded-full border-2 border-gray-300 hover:border-emerald-500 hover:bg-emerald-50 text-emerald-600 flex items-center justify-center transition cursor-pointer shrink-0 shadow-2xs group"
                                title="Clicca per contrassegnare come Completato"
                              >
                                <Check className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-emerald-600 transition-opacity" />
                              </button>

                              {/* Dettaglio Task */}
                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {/* Badge Categoria */}
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black border ${catConf.bg} ${catConf.text} ${catConf.border}`}>
                                      <span>{catConf.icon}</span>
                                      <span className="uppercase">{catConf.label}</span>
                                    </span>

                                    {/* Titolo Attività */}
                                    <span className="text-xs font-bold text-gray-900">
                                      {task.titolo}
                                    </span>
                                  </div>

                                  {/* Badge Scadenza */}
                                  {scadStatus ? (
                                    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border shrink-0 ${scadStatus.badgeClass}`}>
                                      {scadStatus.isOverdue ? (
                                        <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                                      ) : (
                                        <Clock className="w-3 h-3 shrink-0" />
                                      )}
                                      <span>{scadStatus.label}</span>
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-gray-400 font-medium shrink-0">
                                      Nessuna scadenza
                                    </span>
                                  )}
                                </div>

                                {/* Descrizione/Note aggiuntive se presenti */}
                                {task.descrizione && (
                                  <p className="text-[11px] text-gray-600 bg-gray-50/80 p-2 rounded-lg border border-gray-100 whitespace-pre-wrap leading-relaxed">
                                    {task.descrizione}
                                  </p>
                                )}

                                {/* Info creazione */}
                                <div className="text-[10px] text-gray-400 flex items-center gap-2 pt-0.5">
                                  <span>Assegnato a: <strong className="text-gray-600">{task.assegnatoA}</strong></span>
                                  {task.creatoDa && (
                                    <span>&bull; Creato da <span className="text-gray-500 font-medium">{task.creatoDa}</span></span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer Modale */}
            <div className="p-4 px-6 border-t border-gray-150 bg-gray-50 flex items-center justify-between text-xs text-gray-500 rounded-b-3xl shrink-0">
              <span className="font-medium hidden sm:inline">
                💡 Clicca sul cerchietto di un'attività per completarla subito, oppure su <strong>Apri ToDo</strong> per accedere alla checklist completa della commessa.
              </span>
              <button
                type="button"
                onClick={() => setIsMyTasksModalOpen(false)}
                className="px-5 py-2 bg-gray-800 hover:bg-gray-900 text-white font-bold rounded-xl transition cursor-pointer text-xs ml-auto"
              >
                Chiudi
              </button>
            </div>

          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        type={confirmConfig.type}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
