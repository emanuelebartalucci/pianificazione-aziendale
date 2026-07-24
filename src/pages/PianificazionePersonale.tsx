import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth, type Dipendente } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, doc, writeBatch, addDoc, updateDoc } from 'firebase/firestore';
import { Users, ChevronLeft, ChevronRight, Save, Download, ZoomIn, ZoomOut, Trash2, Plus, RefreshCw, CalendarDays } from 'lucide-react';
import { getWeekNumber, getStartOfWeek, addDays, isItalianHoliday } from '../utils/date';

import ConfirmModal from '../components/ConfirmModal';
import { addPendingNotification, getPendingNotifications, clearPendingNotifications, sendAllPendingNotifications } from '../utils/pendingNotifications';
import { isCollaboratore, isSoci } from './Impostazioni';
import { TIPOLOGIA_COLORS } from '../utils/commesseIniziali';
import { queueMail } from '../utils/mailSender';

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
    richiesteDisegnatori = []
  } = useAuth();
  
  const [commessaSearchText, setCommessaSearchText] = useState('');
  const [isCommessaDropdownOpen, setIsCommessaDropdownOpen] = useState(false);
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

  // Sincronizza allocDataInizio e allocDataFine con le settimane selezionate
  useEffect(() => {
    const startOpt = selectableWeekOptions.find(o => o.id === selectedStartWeekId);
    const endOpt = selectableWeekOptions.find(o => o.id === selectedEndWeekId);

    if (startOpt && endOpt) {
      setAllocDataInizio(startOpt.mondayStr);
      setAllocDataFine(endOpt.sundayStr);
    }
  }, [selectedStartWeekId, selectedEndWeekId, selectableWeekOptions]);

  // Pre-selezione automatica dell'intervallo settimane quando viene selezionata una commessa
  useEffect(() => {
    if (selectedCommessaId) {
      const comm = commesse.find(c => c.id === selectedCommessaId);
      if (comm && (comm.dataInizio || comm.dataFine)) {
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
    }
  }, [selectedCommessaId, commesse, selectableWeekOptions]);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  // Pending notifications states
  const [pendingNotificationsCount, setPendingNotificationsCount] = useState(0);
  const [sendingNotifications, setSendingNotifications] = useState(false);

  const [commesseToRemove, setCommesseToRemove] = useState<string[]>([]);

  // Gestione parametri URL per il collegamento da altre pagine (es. Commesse.tsx)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    const commessaIdParam = params.get('commessaId');
    const risorsaParam = params.get('risorsa');
    const weekIdParam = params.get('weekId');

    if (tabParam === 'commessa' && commessaIdParam) {
      setActiveTab('commessa');
      setSelectedCommessaId(commessaIdParam);
      const commObj = commesse.find(c => c.id === commessaIdParam);
      if (commObj) {
        setCommessaSearchText(commObj.nome);
      }
      if (weekIdParam) {
        const matched = selectableWeekOptions.find(o => o.id === weekIdParam);
        if (matched) {
          setSelectedStartWeekId(matched.id);
          setSelectedEndWeekId(matched.id);
        }
      }
      setTimeout(() => {
        plannerContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } else if (tabParam === 'risorsa' && risorsaParam) {
      setActiveTab('risorsa');
      setSelectedResourceForTab(decodeURIComponent(risorsaParam));
      if (weekIdParam) {
        const matched = selectableWeekOptions.find(o => o.id === weekIdParam);
        if (matched) {
          setSelectedStartWeekId(matched.id);
          setSelectedEndWeekId(matched.id);
        }
      }
      setTimeout(() => {
        plannerContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [commesse, selectableWeekOptions]);

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
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Settimana Inizio */}
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 ml-0.5">
              Settimana di Inizio
            </label>
            <select
              value={selectedStartWeekId}
              onChange={e => {
                const newStartId = e.target.value;
                setSelectedStartWeekId(newStartId);
                const startIdx = selectableWeekOptions.findIndex(o => o.id === newStartId);
                const endIdx = selectableWeekOptions.findIndex(o => o.id === selectedEndWeekId);
                if (startIdx > endIdx) {
                  setSelectedEndWeekId(newStartId);
                }
              }}
              className="w-full p-2.5 border border-indigo-100 bg-white rounded-xl text-xs font-extrabold text-indigo-950 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm cursor-pointer"
            >
              {selectableWeekOptions.map(opt => (
                <option key={`start-${opt.id}`} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Settimana Fine */}
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 ml-0.5">
              Settimana di Fine
            </label>
            <select
              value={selectedEndWeekId}
              onChange={e => {
                const newEndId = e.target.value;
                const startIdx = selectableWeekOptions.findIndex(o => o.id === selectedStartWeekId);
                const endIdx = selectableWeekOptions.findIndex(o => o.id === newEndId);
                if (endIdx < startIdx) {
                  setSelectedStartWeekId(newEndId);
                }
                setSelectedEndWeekId(newEndId);
              }}
              className="w-full p-2.5 border border-indigo-100 bg-white rounded-xl text-xs font-extrabold text-indigo-950 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm cursor-pointer"
            >
              {selectableWeekOptions.map(opt => (
                <option key={`end-${opt.id}`} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
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

  // Aree coordinate dall'utente loggato (fonte autorevole: collezione coordinatori)
  // NB: spostato qui in alto perché serve a filteredDipendenti e selectableCommesse
  const myCoordinatedAreas = useMemo((): string[] => {
    if (!userEmail) return [];
    return coordinatori
      .filter(c => c.email.toLowerCase() === userEmail)
      .map(c => c.area);
  }, [userEmail, coordinatori]);

  // Search filter for allocator
  const [searchQuery, setSearchQuery] = useState('');

  // Macro area del dipendente loggato (fallback per PM non coordinatori)
  const myMacroArea = useMemo((): MacroArea | null => {
    if (isAdmin || isSoci(myAssociatedName)) return null; // admin/soci vedono tutto
    const myDip = dipendenti.find(d => d.email?.toLowerCase() === userEmail);
    return (myDip?.macroArea as MacroArea) || null;
  }, [isAdmin, myAssociatedName, dipendenti, userEmail]);

  const filteredDipendenti = useMemo(() => {
    let list = dipendenti.filter(d => {
      const clean = d.nome.toLowerCase().trim();
      const isSocio = clean === 'corbellini matteo' || clean === 'profeti andrea' || clean === 'matteo corbellini' || clean === 'andrea profeti';
      return !isSocio;
    });
    // Esclude risorse cessate in passato
    const todayStr = new Date().toLocaleDateString('sv-SE');
    list = list.filter(d => !d.dataCessazione || d.dataCessazione >= todayStr);

    // Coordinatori e PM vedono solo le risorse della propria macro area
    // Admin e Soci vedono tutto; isSenior non è più un bypass
    if (!isAdmin && !isSoci(myAssociatedName)) {
      if (myCoordinatedAreas.length > 0) {
        list = list.filter(d => myCoordinatedAreas.includes(d.macroArea || ''));
      } else if (myMacroArea) {
        list = list.filter(d => d.macroArea === myMacroArea);
      }
    }

    if (!searchQuery) return list;
    return list.filter(d => d.nome.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [dipendenti, searchQuery, myMacroArea, myCoordinatedAreas, isAdmin, myAssociatedName]);

  const isPMOrResponsabile = useMemo(() => {
    return commesse.some(c => {
      const pmArray = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
      const isPM = pmArray.some(name => areNamesEqual(name, myAssociatedName));
      return isPM || areNamesEqual(c.responsabile, myAssociatedName);
    });
  }, [commesse, myAssociatedName]);

  const selectableCommesse = useMemo(() => {
    const openCommesse = commesse.filter(c => c.stato !== 'Chiusa');
    // Solo Admin e Soci vedono tutte le commesse
    if (isAdmin || isSoci(myAssociatedName)) return openCommesse;
    // Coordinatori, PM e tutti gli altri: solo le commesse in cui sono PM o Responsabile
    return openCommesse.filter(c => {
      const pmArray = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
      const isPM = pmArray.some(name => areNamesEqual(name, myAssociatedName));
      return isPM || areNamesEqual(c.responsabile, myAssociatedName);
    });
  }, [commesse, isAdmin, myAssociatedName]);

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

  const commesseAssegnateAllaRisorsa = useMemo(() => {
    if (!selectedResourceForTab || !allocDataInizio || !allocDataFine) return [];
    try {
      const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
      const map: Record<string, { id: string; nome: string; percentuali: Record<string, number>; colore: string }> = {};
      
      targetWeekIds.forEach(wkId => {
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
  }, [assignments, selectedResourceForTab, allocDataInizio, allocDataFine, commesse]);

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
  const [reqDataInizio, setReqDataInizio] = useState('');
  const [reqDataFine, setReqDataFine] = useState('');
  const [reqPercentuale, setReqPercentuale] = useState(100);
  const [reqPreferredResource, setReqPreferredResource] = useState('');
  const [reqNota, setReqNota] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [selectedRisorsePerRichiesta, setSelectedRisorsePerRichiesta] = useState<Record<string, string>>({});

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

  const getWeekId = (d: Date): string => {
    const date = new Date(d.getTime());
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const year = date.getFullYear();
    const wkNum = getWeekNumber(date);
    return `${year}-W${wkNum}`;
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
      
      await addDoc(collection(db, 'richieste_disegnatori'), {
        commessaId: reqCommessaId,
        commessaName: commName,
        dataInizio: reqDataInizio,
        dataFine: reqDataFine,
        percentuale: Number(reqPercentuale),
        risorsaPreferita: reqPreferredResource || '',
        nota: reqNota,
        richiedenteNome: myAssociatedName || user?.displayName || userEmail || '',
        richiedenteEmail: userEmail,
        stato: 'in_attesa',
        area: reqAreaTarget
      });

      // Invia email ai coordinatori dell'area richiesta
      const coordAreaEmails = coordinatori
        .filter(c => c.area === reqAreaTarget && c.email)
        .map(c => c.email.toLowerCase());
      
      if (coordAreaEmails.length > 0) {
        const richiedente = myAssociatedName || userEmail;
        const subject = `[Richiesta Personale] Richiesta risorsa ${reqAreaTarget} per commessa ${commName}`;
        const htmlBody = `
          <p>Gentile Coordinatore,</p>
          <p>È stata ricevuta una nuova richiesta di personale dall'area <strong>${reqAreaTarget}</strong>.</p>
          <table border="0" cellpadding="6" cellspacing="0" style="font-size:13px;color:#374151;width:100%">
            <tr><td style="font-weight:bold;width:180px">Commessa:</td><td>${commName}</td></tr>
            <tr><td style="font-weight:bold">Richiedente:</td><td>${richiedente} (${userEmail})</td></tr>
            <tr><td style="font-weight:bold">Periodo:</td><td>${reqDataInizio} → ${reqDataFine}</td></tr>
            <tr><td style="font-weight:bold">Carico Richiesto:</td><td>${reqPercentuale}%</td></tr>
            ${reqPreferredResource ? `<tr><td style="font-weight:bold">Risorsa Preferita:</td><td><strong style="color:#4f46e5">${reqPreferredResource}</strong></td></tr>` : ''}
            ${reqNota ? `<tr><td style="font-weight:bold">Nota:</td><td><em>${reqNota}</em></td></tr>` : ''}
          </table>
          <p style="margin-top:16px">Accedi alla <strong>Pianificazione del Personale e Carichi</strong> per gestire questa richiesta e assegnare la risorsa più adeguata.</p>
        `;
        for (const email of coordAreaEmails) {
          if (email.toLowerCase() !== userEmail.toLowerCase()) {
            await queueMail(email, subject, htmlBody);
          }
        }
      }
      
      showToast(`Richiesta ${reqAreaTarget} inviata con successo!`, "success");
      setIsRequestModalOpen(false);
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

  const handleApproveRequest = async (req: any) => {
    const risorsaNome = req.risorsaPreferita || selectedRisorsePerRichiesta[req.id] || '';
    if (!risorsaNome) {
      showToast("Seleziona una risorsa per completare l'operazione.", "warning");
      return;
    }

    const isCancellation = Number(req.percentuale) === 0 || 
      (req.tipoRichiesta || '').toLowerCase().includes('annullamento') || 
      (req.tipoRichiesta || '').toLowerCase().includes('rimozione');

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
      
      const commObj = commesse.find(c => c.id === req.commessaId);
      const colore = commObj ? (TIPOLOGIA_COLORS[commObj.tipologia || ''] || commObj.colore || '#64748b') : '#64748b';

      for (const wkId of weekIds) {
        const docId = `${risorsaNome}-${wkId}`;
        const currentList = [...(assignments[docId] || [])];
        const filtered = currentList.filter(c => c.commessaId !== req.commessaId);

        // Aggiungiamo l'assegnazione SOLO se non si tratta di un annullamento/rimozione
        if (!isCancellation && Number(req.percentuale) > 0) {
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
        risorseAssegnata: risorsaNome
      });
      
      await batch.commit();

      // Notifica al richiedente dell'approvazione (se non è se stesso)
      const isSelfRequestor = (req.richiedenteEmail && req.richiedenteEmail.toLowerCase() === userEmail.toLowerCase()) || areNamesEqual(req.richiedenteNome, myAssociatedName);
      if (req.richiedenteEmail && !isSelfRequestor) {
        const areaLabel = req.area || 'Disegnatori';
        const subject = isCancellation 
          ? `[Approvato Annullamento] Rimosso ${risorsaNome} da ${req.commessaName}`
          : `[Approvata] Richiesta ${areaLabel} per ${req.commessaName}`;
        const htmlBody = isCancellation ? `
          <p>Gentile ${req.richiedenteNome || req.richiedenteEmail},</p>
          <p>La tua richiesta di <strong style="color:#e11d48">rimozione della risorsa ${risorsaNome}</strong> dalla commessa <strong>${req.commessaName}</strong> è stata <strong style="color:#059669">approvata</strong>.</p>
          <p>La risorsa è stata rimossa dalla commessa per il periodo ${req.dataInizio} → ${req.dataFine}.</p>
        ` : `
          <p>Gentile ${req.richiedenteNome || req.richiedenteEmail},</p>
          <p>La tua richiesta di personale dell'area <strong>${areaLabel}</strong> per la commessa <strong>${req.commessaName}</strong> è stata <strong style="color:#059669">approvata</strong>.</p>
          <p>Risorsa assegnata: <strong>${risorsaNome}</strong></p>
          <p>Periodo: ${req.dataInizio} → ${req.dataFine} | Carico: ${req.percentuale}%</p>
        `;
        await queueMail(req.richiedenteEmail, subject, htmlBody);
      }

      showToast(isCancellation ? `Annullamento approvato: ${risorsaNome} rimosso dalla commessa!` : `Richiesta approvata per ${risorsaNome}!`, "success");
    } catch (err) {
      console.error("Errore approvazione richiesta:", err);
      showToast("Errore durante l'approvazione.", "error");
    }
  };

  const handleRejectRequest = async (reqId: string) => {
    setConfirmConfig({
      isOpen: true,
      title: "Rifiuta Richiesta",
      message: "Sei sicuro di voler rifiutare questa richiesta?",
      type: "warning",
      onConfirm: async () => {
        try {
          const reqRef = doc(db, 'richieste_disegnatori', reqId);
          await updateDoc(reqRef, { stato: 'rifiutata' });
          showToast("Richiesta rifiutata con successo.");
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          console.error("Errore rifiuto richiesta:", err);
          showToast("Errore durante il rifiuto della richiesta.", "error");
        }
      }
    });
  };



  const getLeavesForResourceInWeek = (resName: string, wkId: string) => {
    const parts = wkId.split('-W');
    if (parts.length !== 2) return [];
    const year = parseInt(parts[0]);
    const week = parseInt(parts[1]);

    const simple = new Date(year, 0, 4);
    const dayOfWeek = simple.getDay();
    const dayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const firstMonday = new Date(simple.setDate(simple.getDate() + dayOffset));
    const monday = new Date(firstMonday.setDate(firstMonday.getDate() + (week - 1) * 7));

    const weekDates: string[] = [];
    for (let i = 0; i < 5; i++) {
      const dObj = new Date(monday);
      dObj.setDate(monday.getDate() + i);
      const y = dObj.getFullYear();
      const m = String(dObj.getMonth() + 1).padStart(2, '0');
      const ds = String(dObj.getDate()).padStart(2, '0');
      weekDates.push(`${y}-${m}-${ds}`);
    }

    const leaveDaysFound: { giorno: string; tipo: string; dettagli: string }[] = [];
    const dayNames = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];

    // 1. Aggiungi le ferie approvate individuali
    approvedLeaves.forEach(leave => {
      if (leave.dipendenteName !== resName) return;
      const start = leave.dataInizio || leave.data;
      const end = leave.dataFine || leave.data;
      if (start && end) {
        const [sY, sM, sD] = start.split('-').map(Number);
        const [eY, eM, eD] = end.split('-').map(Number);
        const curr = new Date(sY, sM - 1, sD);
        const last = new Date(eY, eM - 1, eD);

        weekDates.forEach((wDateStr, idx) => {
          const [wY, wM, wD] = wDateStr.split('-').map(Number);
          const wDate = new Date(wY, wM - 1, wD);
          if (wDate >= curr && wDate <= last && !isItalianHoliday(wDateStr)) {
            const alreadyExists = leaveDaysFound.some(l => l.giorno === dayNames[idx]);
            if (!alreadyExists) {
              let label = leave.tipo === 'ferie' ? 'Ferie' : leave.tipo === 'malattia' ? 'Malattia' : leave.tipo === 'maternita' ? 'Maternità' : leave.tipo === 'smart' ? 'Smart' : leave.tipo;
              if (leave.tipo === 'mattina') label = 'Ass. Matt.';
              if (leave.tipo === 'pomeriggio') label = 'Ass. Pom.';
              if (leave.tipo === 'permesso') label = `Perm. (${leave.oraInizio || ''}-${leave.oraFine || ''})`;

              leaveDaysFound.push({
                giorno: dayNames[idx],
                tipo: leave.tipo,
                dettagli: label
              });
            }
          }
        });
      }
    });

    return leaveDaysFound;
  };

  const isFullWeekLeave = (resName: string, wkId: string) => {
    const leaves = getLeavesForResourceInWeek(resName, wkId);
    const fullLeaveDays = leaves.filter(l => 
      l.tipo === 'ferie' || 
      l.tipo === 'malattia' || 
      l.tipo === 'maternita' || 
      (l.tipo !== 'smart' && l.tipo !== 'permesso' && l.tipo !== 'mattina' && l.tipo !== 'pomeriggio')
    );
    const uniqueDays = new Set(fullLeaveDays.map(l => l.giorno));
    return uniqueDays.size >= 5;
  };

  const getDayLoad = (dayName: string, commesseLoad: number, dayLeaves: any[]) => {
    const leavesForDay = dayLeaves.filter(l => l.giorno === dayName);
    let leaveLoad = 0;
    if (leavesForDay.length > 0) {
      const haGiornataIntera = leavesForDay.some(l => 
        l.tipo === 'ferie' || 
        l.tipo === 'malattia' || 
        l.tipo === 'maternita' || 
        (l.tipo !== 'smart' && l.tipo !== 'permesso' && l.tipo !== 'mattina' && l.tipo !== 'pomeriggio')
      );
      if (haGiornataIntera) {
        leaveLoad = 100;
      } else {
        const haMezzaGiornata = leavesForDay.some(l => 
          l.tipo === 'permesso' || 
          l.tipo === 'mattina' || 
          l.tipo === 'pomeriggio'
        );
        if (haMezzaGiornata) {
          leaveLoad = 50;
        }
      }
    }
    return leaveLoad + commesseLoad;
  };

  const calculateWeeklyLoad = (dipName: string, wkId: string, rawList: any[]) => {
    const isFullLeave = isFullWeekLeave(dipName, wkId);
    const list = isFullLeave ? [] : rawList;
    const leaves = getLeavesForResourceInWeek(dipName, wkId);
    const commesseLoad = list.reduce((acc, c) => acc + Number(c.percentuale), 0);
    const baseDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
    let totalWeekPct = 0;
    for (const day of baseDays) {
      totalWeekPct += getDayLoad(day, commesseLoad, leaves);
    }
    return Math.round(totalWeekPct / 5);
  };

  const getBlockedDatesForResource = (resName: string, startDateStr: string, endDateStr: string) => {
    const blockedDates: Record<string, boolean> = {};

    // 1. Aggiungi le ferie approvate
    approvedLeaves.forEach(leave => {
      if (leave.dipendenteName !== resName) return;
      const start = leave.dataInizio || leave.data;
      const end = leave.dataFine || leave.data;
      if (start && end) {
        const [sY, sM, sD] = start.split('-').map(Number);
        const [eY, eM, eD] = end.split('-').map(Number);
        const curr = new Date(sY, sM - 1, sD);
        const last = new Date(eY, eM - 1, eD);
        while (curr <= last) {
          const y = curr.getFullYear();
          const m = String(curr.getMonth() + 1).padStart(2, '0');
          const ds = String(curr.getDate()).padStart(2, '0');
          blockedDates[`${y}-${m}-${ds}`] = true;
          curr.setDate(curr.getDate() + 1);
        }
      }
    });



    // 3. Aggiungi le festività nazionali italiane nel range date
    if (startDateStr && endDateStr) {
      const [startY, startM, startD] = startDateStr.split('-').map(Number);
      const [endY, endM, endD] = endDateStr.split('-').map(Number);
      const currDObj = new Date(startY, startM - 1, startD);
      const endDObj = new Date(endY, endM - 1, endD);
      while (currDObj <= endDObj) {
        const y = currDObj.getFullYear();
        const m = String(currDObj.getMonth() + 1).padStart(2, '0');
        const ds = String(currDObj.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${ds}`;
        if (isItalianHoliday(dateStr)) {
          blockedDates[dateStr] = true;
        }
        currDObj.setDate(currDObj.getDate() + 1);
      }
    }

    return blockedDates;
  };

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
    const isUserAllowed = isAdmin || isSoci(myAssociatedName) || areNamesEqual(commObj.responsabile, myAssociatedName) || isPM;
    if (!isUserAllowed) {
      showToast("Non hai i permessi per questa commessa (PM/Responsabile o Admin richiesto).", "error");
      return;
    }


    const updatedAssignments = { ...assignments };
    const newNotifications = [...draftNotifications];

    try {
      const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);

      const blockedDates = getBlockedDatesForResource(resName, allocDataInizio, allocDataFine);
      const blockedDatesArray = Object.keys(blockedDates);
      if (blockedDatesArray.length > 0) {
        setConfirmConfig({
          isOpen: true,
          title: '⚠️ Avviso Conflitto Assenze',
          message: `L'assegnazione per ${resName} è stata registrata in bozza, ma si segnala che nel periodo selezionato la risorsa ha registrato ferie o permessi.`,
          type: 'warning',
          onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false }))
        });
      }

      for (const wkId of targetWeekIds) {
        const docId = `${resName}-${wkId}`;
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

        if (actualPct === 0) continue;

        const currentList = updatedAssignments[docId] || [];
        const filteredList = currentList.filter(a => a.commessaId !== commessaId);
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
      showToast("Assegnazione registrata in bozza!", "success");
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
      }

      // Applica le notifiche accumulate in locale
      draftNotifications.forEach(n => {
        addPendingNotification(n.dipendenteNome, n.email, n.weekLabel, n.description);
      });
      updatePendingNotificationsCount();
      
      setDbAssignments(assignments);
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

  const handleCellClick = (dipNome: string, weekId: string, _weekLabel?: string, _weekSub?: string) => {
    setActiveTab('risorsa');
    setSelectedResourceForTab(dipNome);

    if (weekId) {
      const matchedOpt = selectableWeekOptions.find(o => o.id === weekId);
      if (matchedOpt) {
        setSelectedStartWeekId(matchedOpt.id);
        setSelectedEndWeekId(matchedOpt.id);
      }
    }

    setTimeout(() => {
      plannerContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
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
      const pmArray = Array.isArray(commObj.pm) ? commObj.pm : (commObj.pm ? [commObj.pm] : []);
      const isPM = pmArray.some(name => areNamesEqual(name, myAssociatedName));
      const isUserAllowed = isAdmin || isSoci(myAssociatedName) || areNamesEqual(commObj.responsabile, myAssociatedName) || isPM;
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
        const blockedDatesB = getBlockedDatesForResource(targetResource, allocDataInizio, allocDataFine);
        const blockedDatesArrayB = Object.keys(blockedDatesB);
        if (blockedDatesArrayB.length > 0) {
          setConfirmConfig({
            isOpen: true,
            title: '⚠️ Avviso Conflitto Sostituzione',
            message: `La sostituzione è stata registrata in bozza, ma si segnala che nel periodo selezionato la risorsa sostitutiva ${targetResource} ha registrato ferie o permessi.`,
            type: 'warning',
            onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false }))
          });
        }

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
    
    let list = dipendenti;
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

  const renderEmployeeRow = (dip: Dipendente, parentAreaName: string) => {
    const isCoordinatoreArea = coordinatori.some(c => c.email.toLowerCase() === userEmail && c.area === parentAreaName);
    // Può modificare la cella se è admin/socio, o coordinatore di quest'area
    const isEditable = isAdmin || isSoci(myAssociatedName) || isCoordinatoreArea;
    const isResponsabileDiQuestArea = coordinatori.some(c => c.email.toLowerCase() === dip.email?.toLowerCase() && c.area === parentAreaName);

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
          
          const isCellModified = (() => {
            const listStr = JSON.stringify(list);
            const dbListStr = JSON.stringify(dbAssignments[key] || []);
            return listStr !== dbListStr;
          })();

          const weekStartStr = wk.dateObj ? wk.dateObj.toLocaleDateString('sv-SE') : '';
          const isWeekCessato = dip.dataCessazione && weekStartStr && weekStartStr > dip.dataCessazione;

          // I Disegnatori possono essere modificati solo da Romanello (coordinatore) o admin
          const isDisegnatore = parentAreaName === 'Disegnatori';
          // Admin/Soci e coordinatori dell'area possono sempre editare;
          // PM possono editare le celle delle risorse delle proprie commesse
          // Disegnatori: solo coordinatore dell'area o admin/soci
          const canDirectlyEditCell = !isWeekCessato && (isEditable || isPMOrResponsabile) && (!isDisegnatore || isAdmin || isSoci(myAssociatedName) || isCoordinatoreArea);

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

          const ferieCount = leaves.filter(l => l.tipo === 'ferie').length;
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
              onClick={() => canDirectlyEditCell && handleCellClick(dip.nome, wk.id, wk.label, wk.sub)}
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
                className="flex flex-col items-center justify-center relative group/cell"
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
                    
                    {(list.length > 0 || leaves.length > 0) && (
                      <div className="hidden group-hover/cell:flex absolute top-full mt-1 bg-gray-900 text-white text-[11px] rounded-lg p-2.5 flex-col gap-1 z-50 shadow-md min-w-[170px] pointer-events-none text-left">
                        <div className="font-bold text-[10px] text-indigo-300 border-b border-gray-800 pb-0.5 mb-1">{dip.nome} ({wk.label})</div>
                        {list.map((a, idx) => (
                          <div key={idx} className="flex justify-between items-center gap-2 border-b border-gray-800 pb-1 last:border-none last:pb-0">
                            <span className="truncate">{a.commessaName}</span>
                            <span className="font-extrabold text-indigo-400">{a.percentuale}%</span>
                          </div>
                        ))}
                        {leaves.length > 0 && (
                          <div className="border-t border-gray-700 pt-1.5 mt-1 flex flex-col gap-1">
                            <span className="text-[9.5px] font-bold text-orange-400">Assenze/Ferie:</span>
                            {leaves.map((l, idx) => (
                              <div key={idx} className="flex justify-between items-center text-[9.5px] gap-2">
                                <span>{l.giorno}</span>
                                <span className="font-bold text-gray-300">{l.dettagli}</span>
                              </div>
                            ))}
                          </div>
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
                const isACoord = coordinatori.some(c => c.email.toLowerCase() === a.email?.toLowerCase() && c.area === areaName);
                const isBCoord = coordinatori.some(c => c.email.toLowerCase() === b.email?.toLowerCase() && c.area === areaName);
                if (isACoord && !isBCoord) return -1;
                if (!isACoord && isBCoord) return 1;
                return a.nome.localeCompare(b.nome);
              });
              return sortedMembers.map(dip => renderEmployeeRow(dip, areaName));
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
            {(isAdmin || isSoci(myAssociatedName) || myCoordinatedAreas.length > 0) &&
              richiesteDisegnatori.filter(r => {
                const rArea = r.area || 'Disegnatori';
                if (isAdmin || isSoci(myAssociatedName)) return r.stato === 'in_attesa';
                return r.stato === 'in_attesa' && myCoordinatedAreas.includes(rArea);
              }).length > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-black px-2 py-1 rounded-full shadow-sm animate-pulse ml-2">
                {richiesteDisegnatori.filter(r => {
                  const rArea = r.area || 'Disegnatori';
                  if (isAdmin || isSoci(myAssociatedName)) return r.stato === 'in_attesa';
                  return r.stato === 'in_attesa' && myCoordinatedAreas.includes(rArea);
                }).length} RICHIESTE IN ATTESA
              </span>
            )}
            <button 
              onClick={() => window.location.reload()}
              title="Aggiorna Dati"
              className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 border border-transparent hover:border-indigo-100 rounded-xl transition-all cursor-pointer hover:rotate-180 duration-500"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </h2>
      </div>

      {/* SEZIONE GESTIONE RICHIESTE PERSONALE (per tutte le aree) */}
      {(() => {
        // Determina quali richieste deve vedere l'utente loggato
        const visibleReqs = richiesteDisegnatori.filter(r => {
          if (r.stato !== 'in_attesa') return false;
          const rArea = r.area || 'Disegnatori';
          if (isAdmin || isSoci(myAssociatedName)) return true;
          return myCoordinatedAreas.includes(rArea);
        });

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
          return filteredGridDipendenti.filter(d => !isSoci(d.nome) && d.macroArea === areaName);
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
                  const targetResource = req.risorsaPreferita || req.risorseAssegnata || 'Risorsa';
                  const selectedRisorsa = selectedRisorsePerRichiesta[req.id] ?? targetResource;

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

                  return (
                    <div key={req.id} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between gap-3 text-xs">
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className={`font-extrabold ${colors.heading} text-sm`}>{req.commessaName}</span>
                          <span className={`${colors.badge} px-2 py-0.5 rounded-full font-bold uppercase tracking-wider text-[9px]`}>In Attesa</span>
                        </div>
                        <div className="text-gray-500 mt-1 space-y-1">
                          <div>📅 Periodo: <strong className="text-gray-700">{formatCommDate(req.dataInizio)}</strong> al <strong className="text-gray-700">{formatCommDate(req.dataFine)}</strong></div>
                          <div>⚡ Carico Richiesto: <strong className="text-gray-800">{req.percentuale}%</strong></div>
                          {req.risorsaPreferita && (
                            <div className="text-indigo-900 bg-indigo-50/70 px-2 py-1 rounded-lg border border-indigo-100 w-fit">
                              ⭐ Risorsa Preferita: <strong className="text-indigo-700 font-black">{req.risorsaPreferita}</strong>
                            </div>
                          )}
                          <div>👤 Richiedente: <span className="font-semibold text-gray-700">{req.richiedenteNome}</span> ({req.richiedenteEmail})</div>
                          {req.nota && (
                            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 italic text-gray-600 mt-2">
                              &ldquo;{req.nota}&rdquo;
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-gray-100">
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
                      placeholder="Cerca commessa..."
                      value={selectedCommessaId ? (commesse.find(c => c.id === selectedCommessaId)?.nome || '') : commessaSearchText}
                      onChange={e => {
                        setCommessaSearchText(e.target.value);
                        if (selectedCommessaId) setSelectedCommessaId('');
                        setIsCommessaDropdownOpen(true);
                      }}
                      onFocus={() => setIsCommessaDropdownOpen(true)}
                      className="w-full p-2.5 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-750"
                    />
                    {selectedCommessaId && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCommessaId('');
                          setCommessaSearchText('');
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-red-500 hover:text-red-700 font-extrabold text-[10px] bg-red-50 px-2 py-1 rounded-lg transition"
                      >
                        Rimuovi
                      </button>
                    )}
                  </div>
                  {isCommessaDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setIsCommessaDropdownOpen(false)}></div>
                      <div className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto bg-white border border-gray-150 rounded-xl shadow-xl divide-y divide-gray-50">
                        {(() => {
                          const search = commessaSearchText.toLowerCase();
                          const filtered = selectableCommesse.filter(c =>
                            c.nome.toLowerCase().includes(search) ||
                            (c.cliente && c.cliente.toLowerCase().includes(search))
                          );
                          if (filtered.length === 0) {
                            return <div className="p-3 text-xs text-gray-450 italic font-bold">Nessuna commessa abilitata trovata</div>;
                          }
                          return filtered.map(c => (
                            <button
                              key={c.id}
                              type="button"
                              title={c.nome}
                              onClick={() => {
                                setSelectedCommessaId(c.id);
                                setCommessaSearchText(c.nome);
                                setIsCommessaDropdownOpen(false);
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-indigo-50 text-xs font-semibold text-gray-700 transition-colors flex flex-col gap-0.5 cursor-pointer"
                            >
                              <span className="truncate w-full font-bold text-gray-800">{c.nome}</span>
                              <span className="text-[9.5px] text-indigo-650 font-semibold italic">
                                💼 Cliente: {c.cliente || 'Nessun cliente'}
                              </span>
                            </button>
                          ));
                        })()}
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

                  {/* Lista Risorse Assegnate */}
                  <div className="bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col max-h-[520px]">
                    <h4 className="font-bold text-sm text-indigo-900 border-b pb-2 mb-3">
                      👥 Risorse Assegnate ({risorseAssegnateAllaCommessa.length})
                    </h4>
                    <div className="overflow-y-auto flex-1 space-y-2 pr-1 scrollbar-thin">
                      {risorseAssegnateAllaCommessa.length === 0 ? (
                        <p className="text-xs text-gray-405 italic p-3 text-center">Nessuna risorsa assegnata in questo periodo.</p>
                      ) : (
                        risorseAssegnateAllaCommessa.map(r => {
                          const pcts = Object.values(r.percentuali);
                          const minPct = Math.min(...pcts);
                          const maxPct = Math.max(...pcts);
                          const displayPct = minPct === maxPct ? `${minPct}%` : `${minPct}% - ${maxPct}%`;

                          return (
                            <div key={r.nome} className="flex justify-between items-center p-2.5 bg-white rounded-xl border border-indigo-50 shadow-sm hover:border-indigo-100 transition-colors">
                              <div className="flex flex-col gap-0.5 truncate pr-2">
                                <span className="font-bold text-xs text-gray-850 truncate">{r.nome}</span>
                                {displayPct && <span className="text-[10px] font-black text-indigo-650">Impegno commessa: {displayPct}</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                <select
                                  value={pcts[0] || 100}
                                  disabled={savingAllocations}
                                  onChange={async (e) => {
                                    await executeAssignResourceToCommessa(r.nome, selectedCommessaId, parseInt(e.target.value));
                                  }}
                                  className="p-1 border border-gray-200 rounded-lg bg-white font-bold text-[10px] text-gray-700 outline-none focus:border-indigo-400"
                                >
                                  <option value="10">10%</option>
                                  <option value="20">20%</option>
                                  <option value="30">30%</option>
                                  <option value="40">40%</option>
                                  <option value="50">50%</option>
                                  <option value="60">60%</option>
                                  <option value="70">70%</option>
                                  <option value="80">80%</option>
                                  <option value="90">90%</option>
                                  <option value="100">100%</option>
                                </select>
                                <button
                                  type="button"
                                  disabled={savingAllocations}
                                  onClick={() => {
                                    setConfirmConfig({
                                      isOpen: true,
                                      title: 'Rimozione Risorsa',
                                      message: `Sei sicuro di voler rimuovere ${r.nome} da questa commessa per il periodo selezionato?`,
                                      type: 'danger',
                                      onConfirm: async () => {
                                        await executeRemoveResourceFromCommessa(r.nome, selectedCommessaId);
                                        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                                      }
                                    });
                                  }}
                                  className="text-red-500 hover:text-red-750 hover:bg-red-55 p-1.5 rounded-lg transition-colors disabled:opacity-50"
                                  title="Rimuovi risorsa da questa commessa"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
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
                    <select
                      value={selectedResourceForTab}
                      onChange={e => setSelectedResourceForTab(e.target.value)}
                      className="w-full p-2.5 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-800 cursor-pointer"
                    >
                      <option value="">-- Seleziona Risorsa --</option>
                      {filteredDipendenti.map(d => (
                        <option key={d.id} value={d.nome}>{d.nome} {d.macroArea ? `(${d.macroArea})` : ''}</option>
                      ))}
                    </select>
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
                        <div>
                          <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Seleziona Commessa *</label>
                          <select
                            value={addCommessaId}
                            onChange={e => setAddCommessaId(e.target.value)}
                            className="w-full p-3 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-800 cursor-pointer"
                          >
                            <option value="">-- Seleziona Commessa --</option>
                            {selectableCommesse.map(c => (
                              <option key={c.id} value={c.id}>{c.nome} [{c.codiceCommessa}]</option>
                            ))}
                          </select>
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
                      disabled={savingAllocations || !addCommessaId}
                      onClick={async () => {
                        await executeAssignResourceToCommessa(selectedResourceForTab, addCommessaId, parseInt(addPercentage));
                        setAddCommessaId('');
                      }}
                      className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 rounded-xl transition shadow-md active:scale-95 disabled:opacity-50 cursor-pointer mt-6"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Conferma ed Esegui Assegnazione</span>
                    </button>
                  </div>

                  {/* Lista Commesse Assegnate */}
                  <div className="bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col max-h-[480px] min-h-[360px]">
                    <h4 className="font-bold text-sm text-indigo-900 border-b pb-2 mb-3 flex items-center justify-between">
                      <span>📁 Commesse Assegnate</span>
                      <span className="bg-indigo-100 text-indigo-800 font-extrabold text-xs px-2.5 py-0.5 rounded-full">
                        {commesseAssegnateAllaRisorsa.length}
                      </span>
                    </h4>
                    <div className="overflow-y-auto flex-1 space-y-2.5 pr-1 scrollbar-thin">
                      {commesseAssegnateAllaRisorsa.length === 0 ? (
                        <p className="text-xs text-gray-400 italic p-6 text-center">Nessuna commessa assegnata a {selectedResourceForTab} nel periodo selezionato.</p>
                      ) : (
                        commesseAssegnateAllaRisorsa.map(c => {
                          const pcts = Object.values(c.percentuali);
                          const minPct = Math.min(...pcts);
                          const maxPct = Math.max(...pcts);
                          const displayPct = minPct === maxPct ? `${minPct}%` : `${minPct}% - ${maxPct}%`;

                          // Permessi di modifica per questa commessa
                          const commObj = commesse.find(x => x.id === c.id);
                          const pmArray = commObj && commObj.pm ? (Array.isArray(commObj.pm) ? commObj.pm : [commObj.pm]) : [];
                          const isPM = pmArray.some(name => areNamesEqual(name, myAssociatedName));
                          const hasPermission = isAdmin || isSoci(myAssociatedName) || (commObj && (isPM || areNamesEqual(commObj.responsabile, myAssociatedName)));

                          return (
                            <div key={c.id} className="flex justify-between items-center p-3 bg-white rounded-xl border border-indigo-50 shadow-sm hover:border-indigo-100 transition-colors">
                              <div className="flex flex-col gap-1 truncate pr-2">
                                <div className="flex items-center gap-2 truncate">
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: c.colore }}></span>
                                  <span className="font-bold text-xs text-gray-850 truncate">{c.nome}</span>
                                </div>
                                {displayPct && <span className="text-[10px] font-black text-indigo-650 ml-4.5">Impegno commessa: {displayPct}</span>}
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {hasPermission ? (
                                  <>
                                    <select
                                      value={pcts[0] || 100}
                                      disabled={savingAllocations}
                                      onChange={async (e) => {
                                        await executeAssignResourceToCommessa(selectedResourceForTab, c.id, parseInt(e.target.value));
                                      }}
                                      className="p-1.5 border border-gray-200 rounded-lg bg-white font-bold text-xs text-gray-700 outline-none focus:border-indigo-400 cursor-pointer"
                                    >
                                      {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                                        <option key={pct} value={pct}>{pct}%</option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      disabled={savingAllocations}
                                      onClick={() => {
                                        setConfirmConfig({
                                          isOpen: true,
                                          title: 'Rimozione Commessa',
                                          message: `Sei sicuro di voler rimuovere la commessa "${c.nome}" per ${selectedResourceForTab} nel periodo selezionato?`,
                                          type: 'danger',
                                          onConfirm: async () => {
                                            await executeRemoveResourceFromCommessa(selectedResourceForTab, c.id);
                                            setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                                          }
                                        });
                                      }}
                                      className="text-red-500 hover:text-red-750 hover:bg-red-50 p-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                                      title="Rimuovi questa commessa"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </>
                                ) : (
                                  <span className="text-gray-400 text-[10px] italic font-bold bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                                    🔒 Sola Lettura
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
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
                      placeholder="Cerca commessa..."
                      value={selectedCommessaId ? (commesse.find(c => c.id === selectedCommessaId)?.nome || '') : commessaSearchText}
                      onChange={e => {
                        setCommessaSearchText(e.target.value);
                        if (selectedCommessaId) setSelectedCommessaId('');
                        setIsCommessaDropdownOpen(true);
                      }}
                      onFocus={() => setIsCommessaDropdownOpen(true)}
                      className="w-full p-2.5 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-800"
                    />
                    {selectedCommessaId && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCommessaId('');
                          setCommessaSearchText('');
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-red-500 hover:text-red-700 font-extrabold text-[10px] bg-red-50 px-2 py-1 rounded-lg transition cursor-pointer"
                      >
                        Rimuovi
                      </button>
                    )}
                  </div>
                  {isCommessaDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setIsCommessaDropdownOpen(false)}></div>
                      <div className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto bg-white border border-gray-150 rounded-xl shadow-xl divide-y divide-gray-50">
                        {(() => {
                          const search = commessaSearchText.toLowerCase();
                          const filtered = selectableCommesse.filter(c =>
                            c.nome.toLowerCase().includes(search) ||
                            (c.cliente && c.cliente.toLowerCase().includes(search))
                          );
                          if (filtered.length === 0) {
                            return <div className="p-3 text-xs text-gray-450 italic font-bold">Nessuna commessa trovata</div>;
                          }
                          return filtered.map(c => (
                            <button
                              key={c.id}
                              type="button"
                              title={c.nome}
                              onClick={() => {
                                setSelectedCommessaId(c.id);
                                setCommessaSearchText(c.nome);
                                setIsCommessaDropdownOpen(false);
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-indigo-50 text-xs font-semibold text-gray-700 transition-colors flex flex-col gap-0.5 cursor-pointer"
                            >
                              <span className="truncate w-full font-bold text-gray-800">{c.nome}</span>
                              <span className="text-[9.5px] text-indigo-650 font-semibold italic">
                                💼 Cliente: {c.cliente || 'Nessun cliente'}
                              </span>
                            </button>
                          ));
                        })()}
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
      <div className="bg-white rounded-[2rem] shadow-xl border overflow-hidden relative mb-10 flex flex-col max-h-[750px]">
        
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
            
            {/* Grid Search Input */}
            <input 
              type="text" 
              placeholder="Cerca dipendente..." 
              value={gridSearchQuery}
              onChange={e => setGridSearchQuery(e.target.value)}
              className="p-2.5 border rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-400 font-semibold shadow-sm w-44"
            />

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

        {/* Load Grid with clipping for rounded corners */}
        <div className="w-full flex-1 overflow-hidden flex flex-col">
          <div className="w-full overflow-auto scrollbar-thin flex-1 min-h-[320px]">
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
                      renderEmployeeRow(currentDip, currentDip.macroArea || 'Non Assegnati')
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
                    {nonAssegnati.map(dip => renderEmployeeRow(dip, 'Non Assegnati'))}
                  </tbody>
                )}
              </>
            )}
          </table>
        </div>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Settimana Inizio *</label>
                      <select
                        value={(() => {
                          const match = selectableWeekOptions.find(o => o.mondayStr === reqDataInizio);
                          return match ? match.id : selectedStartWeekId;
                        })()}
                        onChange={e => {
                          const id = e.target.value;
                          const startOpt = selectableWeekOptions.find(o => o.id === id);
                          if (startOpt) setReqDataInizio(startOpt.mondayStr);
                        }}
                        className={`w-full p-2.5 border-none bg-slate-50 focus:bg-white rounded-xl text-xs font-bold text-gray-750 outline-none focus:ring-2 ${mc.ring} shadow-inner cursor-pointer`}
                      >
                        {selectableWeekOptions.map(opt => (
                          <option key={`req-start-${opt.id}`} value={opt.id}>{opt.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Settimana Fine *</label>
                      <select
                        value={(() => {
                          const match = selectableWeekOptions.find(o => o.sundayStr === reqDataFine);
                          return match ? match.id : selectedEndWeekId;
                        })()}
                        onChange={e => {
                          const id = e.target.value;
                          const endOpt = selectableWeekOptions.find(o => o.id === id);
                          if (endOpt) setReqDataFine(endOpt.sundayStr);
                        }}
                        className={`w-full p-2.5 border-none bg-slate-50 focus:bg-white rounded-xl text-xs font-bold text-gray-750 outline-none focus:ring-2 ${mc.ring} shadow-inner cursor-pointer`}
                      >
                        {selectableWeekOptions.map(opt => (
                          <option key={`req-end-${opt.id}`} value={opt.id}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

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
    </div>
  );
}

