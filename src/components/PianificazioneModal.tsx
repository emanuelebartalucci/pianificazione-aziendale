import React, { useState, useEffect, useMemo } from 'react';
import { useAuth, isTechnicalUser } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { doc, writeBatch } from 'firebase/firestore';
import { getStartOfWeek, addDays, getWeekNumber } from '../utils/date';
import { addPendingNotification } from '../utils/pendingNotifications';
import { isSoci } from '../pages/Impostazioni';
import { 
  X, 
  CalendarDays, 
  Plus, 
  Trash2, 
  Save, 
  Briefcase, 
  User, 
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
  Lock
} from 'lucide-react';

export interface PianificazioneModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'commessa' | 'risorsa' | 'sostituisci';
  initialCommessaId?: string;
  initialResourceName?: string;
  initialWeekId?: string;
  isLockedContext?: boolean;
  onRequestAreaResource?: (macroArea: string, commessaId: string, weekId: string, personName?: string) => void;
}

interface WeekOption {
  id: string;
  mondayStr: string;
  sundayStr: string;
  label: string;
  weekNum: number;
  year: number;
}

const TIPOLOGIA_COLORS: Record<string, string> = {
  'Gara': '#ec4899',
  'Interna': '#8b5cf6',
  'Offerta': '#f59e0b',
  'Superbonus': '#10b981',
  'Incarico Diretto': '#3b82f6',
  'Convenzione Quadro': '#6366f1',
  'Variante': '#14b8a6',
  'Project Financing': '#84cc16'
};

const areNamesEqual = (name1?: string, name2?: string): boolean => {
  if (!name1 || !name2) return false;
  const n1 = name1.toLowerCase().trim();
  const n2 = name2.toLowerCase().trim();
  if (n1 === n2) return true;
  const parts1 = n1.split(/\s+/).sort().join(' ');
  const parts2 = n2.split(/\s+/).sort().join(' ');
  return parts1 === parts2;
};

export const PianificazioneModal: React.FC<PianificazioneModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'commessa',
  initialCommessaId = '',
  initialResourceName = '',
  initialWeekId = '',
  isLockedContext = true,
  onRequestAreaResource
}) => {
  const { 
    commesse = [], 
    dipendenti = [], 
    coordinatori = [],
    isAdmin = false,
    isDev = false,
    userEmail = '', 
    myAssociatedName = '', 
    assegnazioni = {},
    pmsEmails = [],
    prioritaCommesse = {},
    approvedLeaves = []
  } = useAuth();

  const [activeTab, setActiveTab] = useState<'commessa' | 'risorsa' | 'sostituisci'>(initialTab);
  const [selectedCommessaId, setSelectedCommessaId] = useState(initialCommessaId);
  const [selectedResourceForTab, setSelectedResourceForTab] = useState(initialResourceName);

  const [sourceResource, setSourceResource] = useState('');
  const [targetResource, setTargetResource] = useState('');

  // Per aggiungere risorsa a commessa
  const [addResourceName, setAddResourceName] = useState('');
  const [addResourcePercentage, setAddResourcePercentage] = useState('100');

  // Per aggiungere commessa a risorsa
  const [addCommessaId, setAddCommessaId] = useState('');
  const [addCommessaPercentage, setAddCommessaPercentage] = useState('100');

  // Priorità commessa per la settimana selezionata
  const [selectedPriority, setSelectedPriority] = useState<'Alta' | 'Standard' | 'Bassa'>('Standard');
  const [initialPriority, setInitialPriority] = useState<'Alta' | 'Standard' | 'Bassa'>('Standard');

  // Bozza locale per modifiche non ancora salvate su Firestore
  const [draftAssignments, setDraftAssignments] = useState<Record<string, any[]>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Stato per tracciare quali risorse sono espanse nel pannello Gestione per Commessa
  const [expandedResources, setExpandedResources] = useState<Set<string>>(new Set());

  const toggleResourceExpanded = (resName: string) => {
    setExpandedResources(prev => {
      const next = new Set(prev);
      if (next.has(resName)) next.delete(resName);
      else next.add(resName);
      return next;
    });
  };

  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Generatore opzioni settimane
  const selectableWeekOptions = useMemo(() => {
    const options: WeekOption[] = [];
    const today = new Date();
    let currentMonday = getStartOfWeek(addDays(today, -84)); // 12 settimane fa
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
        label: `Sett. ${wkNum} (${startFormatted} - ${endFormatted})`,
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
  const [selectedEndWeekId, setSelectedEndWeekId] = useState<string>(() => currentWeekOpt.id);

  const [allocDataInizio, setAllocDataInizio] = useState('');
  const [allocDataFine, setAllocDataFine] = useState('');

  // Reset/Inizializzazione all'apertura
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setSelectedCommessaId(initialCommessaId);
      setSelectedResourceForTab(initialResourceName);
      setDraftAssignments(JSON.parse(JSON.stringify(assegnazioni)));
      setHasChanges(false);
      setAddResourceName('');
      setAddResourcePercentage('100');
      setAddCommessaId('');
      setAddCommessaPercentage('100');

      const targetWk = initialWeekId || currentWeekOpt.id;
      const matched = selectableWeekOptions.find(o => o.id === targetWk);
      if (matched) {
        setSelectedStartWeekId(matched.id);
        setSelectedEndWeekId(matched.id);
      } else {
        setSelectedStartWeekId(currentWeekOpt.id);
        setSelectedEndWeekId(currentWeekOpt.id);
      }

      if (initialCommessaId && targetWk) {
        const pKey = `${initialCommessaId}_${targetWk}`;
        const pVal = prioritaCommesse[pKey] || 'Standard';
        setSelectedPriority(pVal);
        setInitialPriority(pVal);
      } else {
        setSelectedPriority('Standard');
        setInitialPriority('Standard');
      }
    }
  }, [isOpen, initialTab, initialCommessaId, initialResourceName, initialWeekId, selectableWeekOptions, currentWeekOpt, assegnazioni, prioritaCommesse]);

  // Sincronizza allocDataInizio e allocDataFine con le settimane selezionate
  useEffect(() => {
    const startOpt = selectableWeekOptions.find(o => o.id === selectedStartWeekId);
    const endOpt = selectableWeekOptions.find(o => o.id === selectedEndWeekId);

    if (startOpt && endOpt) {
      setAllocDataInizio(startOpt.mondayStr);
      setAllocDataFine(endOpt.sundayStr);
    }
  }, [selectedStartWeekId, selectedEndWeekId, selectableWeekOptions]);

  // Dipendenti attivi
  const filteredDipendenti = useMemo(() => {
    return dipendenti.filter(d => (!d.dataCessazione || d.dataCessazione > new Date().toISOString().split('T')[0]) && !isTechnicalUser(d));
  }, [dipendenti]);

  const myDip = useMemo(() => {
    return dipendenti.find(d => d.email?.toLowerCase() === userEmail?.toLowerCase());
  }, [dipendenti, userEmail]);

  // Macroaree coordinate dall'utente corrente (Coordinatori)
  const myCoordinatedAreas = useMemo(() => {
    if (!userEmail) return [];
    const myCoords = (coordinatori || []).filter(c => c.email?.toLowerCase() === userEmail.toLowerCase());
    return myCoords.map(c => c.area);
  }, [userEmail, coordinatori]);

  const isPM = useMemo(() => {
    if (!userEmail) return false;
    if (pmsEmails.includes(userEmail.toLowerCase())) return true;
    if (!myDip) return false;
    return commesse.some(c => {
      const pms = Array.isArray(c.pm) ? c.pm : [c.pm];
      return pms.some(p => p?.toLowerCase().trim() === myDip.nome.toLowerCase().trim());
    });
  }, [userEmail, pmsEmails, myDip, commesse]);

  // Helper per verificare se l'utente corrente è PM o Responsabile di una commessa (matching deterministico su Nome e Cognome)
  const isUserPmOrResp = (comm: any): boolean => {
    if (!comm) return false;

    const respStr = String(comm.responsabile || '').trim();
    const pmList: any[] = Array.isArray(comm.pm) ? comm.pm : (comm.pm ? [comm.pm] : []);
    const targets = [respStr, ...pmList.map(p => String(p || '').trim())].filter(Boolean);

    if (targets.length === 0) return false;

    // 1. Corrispondenza esatta di nome e cognome tramite areNamesEqual (gestisce sia "Nome Cognome" che "Cognome Nome")
    if (myAssociatedName && targets.some(t => areNamesEqual(t, myAssociatedName))) return true;
    if (myDip?.nome && targets.some(t => areNamesEqual(t, myDip.nome))) return true;

    // 2. Corrispondenza email ed username email (es. "aromanello")
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

  // Commesse selezionabili nei menu a tendina: Solo Admin, Dev e Soci vedono tutte le commesse aperte.
  // Tutti gli altri utenti (compresi Coordinatori d'area e PM) vedono SOLO ED ESCLUSIVAMENTE le commesse di cui sono nominati PM o Responsabile.
  const selectableCommesse = useMemo(() => {
    const openCommesse = commesse.filter(c => !c.stato || c.stato !== 'Chiusa');
    if (isAdmin || isDev || isSoci(myAssociatedName)) {
      return openCommesse;
    }
    return openCommesse.filter(c => isUserPmOrResp(c));
  }, [commesse, isAdmin, isDev, myAssociatedName, userEmail, myDip]);

  // Verifica se l'utente collegato è PM o Responsabile della commessa attualmente selezionata
  const isPmOfSelectedCommessa = useMemo(() => {
    if (!selectedCommessaId) return false;
    const comm = commesse.find(c => c.id === selectedCommessaId);
    return isUserPmOrResp(comm);
  }, [selectedCommessaId, commesse, userEmail, myAssociatedName, myDip]);

  // Dipendenti direttamente assegnabili (Admin vedono tutti; Coordinatori/PM vedono solo la propria area di appartenenza)
  const selectableDipendentiForUser = useMemo(() => {
    if (isAdmin) return filteredDipendenti;
    if (myCoordinatedAreas.length > 0) {
      return filteredDipendenti.filter(d => d.macroArea && myCoordinatedAreas.includes(d.macroArea));
    }
    if (myDip?.macroArea) {
      return filteredDipendenti.filter(d => d.macroArea === myDip.macroArea);
    }
    return filteredDipendenti;
  }, [filteredDipendenti, isAdmin, myCoordinatedAreas, myDip]);

  // Helper date e settimane
  const getWeeksSpannedByDates = (startStr: string, endStr: string): string[] => {
    if (!startStr || !endStr) return [];
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];

    let curr = getStartOfWeek(start);
    const weeks: string[] = [];
    while (curr <= end) {
      const wkNum = getWeekNumber(curr);
      const y = curr.getFullYear();
      weeks.push(`${y}-W${wkNum}`);
      curr = addDays(curr, 7);
    }
    return weeks;
  };

  const getCoveredDaysInWeek = (weekId: string, startStr: string, endStr: string): number => {
    const weekOpt = selectableWeekOptions.find(o => o.id === weekId);
    if (!weekOpt) return 0;

    const wStart = new Date(weekOpt.mondayStr);
    const wEnd = new Date(weekOpt.sundayStr);
    const pStart = new Date(startStr);
    const pEnd = new Date(endStr);

    const start = pStart > wStart ? pStart : wStart;
    const end = pEnd < wEnd ? pEnd : wEnd;

    if (start > end) return 0;
    let days = 0;
    let cur = new Date(start);
    while (cur <= end) {
      const d = cur.getDay();
      if (d !== 0 && d !== 6) days++;
      cur = addDays(cur, 1);
    }
    return days;
  };

  const getWeekdayDate = (weekId: string, dayName: string): string => {
    const weekOpt = selectableWeekOptions.find(o => o.id === weekId);
    if (!weekOpt) return '';
    const m = new Date(weekOpt.mondayStr);
    const map: Record<string, number> = { 'Lun': 0, 'Mar': 1, 'Mer': 2, 'Gio': 3, 'Ven': 4 };
    const d = addDays(m, map[dayName] || 0);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  const isResourceOnFullWeekLeave = (resName: string, weekId: string): boolean => {
    if (!resName || !weekId || !approvedLeaves || approvedLeaves.length === 0) return false;
    const weekOpt = selectableWeekOptions.find(o => o.id === weekId);
    if (!weekOpt) return false;

    const monday = new Date(weekOpt.mondayStr);
    const workDates: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = addDays(monday, i);
      workDates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    }

    const resLeaves = approvedLeaves.filter((r: any) => {
      if (!r.dipendenteName) return false;
      if (r.dipendenteName.trim().toLowerCase() !== resName.trim().toLowerCase()) return false;
      if (r.stato !== 'Approvato') return false;
      const t = r.tipo || 'ferie';
      return ['ferie', 'assenza', 'malattia', 'maternita'].includes(t);
    });

    if (resLeaves.length === 0) return false;

    let coveredCount = 0;
    workDates.forEach(dateStr => {
      const isCovered = resLeaves.some((r: any) => {
        const dStart = r.dataInizio || r.data;
        const dEnd = r.dataFine || r.data;
        if (!dStart || !dEnd) return false;
        if (r.frazioneTipo && r.frazioneTipo !== 'giornata') return false;
        return dateStr >= dStart && dateStr <= dEnd;
      });
      if (isCovered) coveredCount++;
    });

    return coveredCount >= 5;
  };

  // Risorse Assegnate e Non Assegnate alla Commessa nel periodo (usa la bozza locale draftAssignments)
  const { risorseAssegnateAllaCommessa, risorseNonAssegnateAllaCommessa } = useMemo(() => {
    if (!selectedCommessaId || !allocDataInizio || !allocDataFine) {
      return { risorseAssegnateAllaCommessa: [], risorseNonAssegnateAllaCommessa: [] };
    }

    const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
    const assignedMap: Record<string, { nome: string; percentuali: Record<string, number> }> = {};

    filteredDipendenti.forEach(dip => {
      targetWeekIds.forEach(wkId => {
        const key = `${dip.nome}-${wkId}`;
        const list = draftAssignments[key] || [];
        const match = list.find((a: any) => a.commessaId === selectedCommessaId);
        if (match) {
          if (!assignedMap[dip.nome]) {
            assignedMap[dip.nome] = { nome: dip.nome, percentuali: {} };
          }
          assignedMap[dip.nome].percentuali[wkId] = match.percentuale;
        }
      });
    });

    const assignedNames = new Set(Object.keys(assignedMap));
    let assignedList = Object.values(assignedMap);

    if (!isAdmin && isPM && myDip?.macroArea && myCoordinatedAreas.length === 0) {
      assignedList = assignedList.filter(r => {
        const dipObj = filteredDipendenti.find(d => d.nome === r.nome);
        return dipObj?.macroArea === myDip.macroArea;
      });
    }

    const nonAssignedList = selectableDipendentiForUser.filter(d => !assignedNames.has(d.nome));

    return {
      risorseAssegnateAllaCommessa: assignedList,
      risorseNonAssegnateAllaCommessa: nonAssignedList
    };
  }, [selectedCommessaId, allocDataInizio, allocDataFine, draftAssignments, filteredDipendenti, selectableDipendentiForUser, isAdmin, isPM, myDip, myCoordinatedAreas]);

  // Commesse Assegnate alla Risorsa nel periodo (usa la bozza locale draftAssignments)
  const commesseAssegnateAllaRisorsa = useMemo(() => {
    if (!selectedResourceForTab || !allocDataInizio || !allocDataFine) return [];
    const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
    const commMap: Record<string, { id: string; nome: string; colore: string; percentuali: Record<string, number> }> = {};

    targetWeekIds.forEach(wkId => {
      const key = `${selectedResourceForTab}-${wkId}`;
      const list = draftAssignments[key] || [];
      list.forEach((a: any) => {
        if (!commMap[a.commessaId]) {
          commMap[a.commessaId] = {
            id: a.commessaId,
            nome: a.commessaName || 'Commessa senza nome',
            colore: a.colore || '#3b82f6',
            percentuali: {}
          };
        }
        commMap[a.commessaId].percentuali[wkId] = a.percentuale;
      });
    });

    return Object.values(commMap);
  }, [selectedResourceForTab, allocDataInizio, allocDataFine, draftAssignments]);

  // Commesse NON ancora assegnate alla Risorsa
  const commesseNonAssegnateAllaRisorsa = useMemo(() => {
    const assignedIds = new Set(commesseAssegnateAllaRisorsa.map(c => c.id));
    return selectableCommesse.filter(c => !assignedIds.has(c.id));
  }, [commesseAssegnateAllaRisorsa, selectableCommesse]);

  // ===========================================================
  // UTILITY: Calcola i sotto-periodi consecutivi per una risorsa
  // ===========================================================
  //
  // Raggruppa le settimane del range in blocchi contigui con la stessa percentuale.
  // Input: percentuali = { 'YYYY-Wnn': pct, ... } (solo le settimane che hanno un'assegnazione)
  //        allWeekIds  = tutte le settimane del range selezionato in ordine
  // Output: array di { weekIds, pct, label }
  interface SubPeriod {
    weekIds: string[];
    pct: number;
    label: string; // es. "Sett. 30 → 35  ·  28 Lug – 1 Set"
  }

  // Helper: lunedì di una weekId come Date
  const getWkMonday = (wkId: string): Date | null => {
    const parts = wkId.split('-W');
    if (parts.length !== 2) return null;
    const year = parseInt(parts[0]);
    const week = parseInt(parts[1]);
    const simple = new Date(year, 0, 4);
    const dow = simple.getDay();
    const offs = dow === 0 ? -6 : 1 - dow;
    const fm = new Date(simple); fm.setDate(simple.getDate() + offs);
    const mon = new Date(fm); mon.setDate(fm.getDate() + (week - 1) * 7);
    return mon;
  };
  const fmtShort = (d: Date | null, includeYear: boolean = false): string => {
    if (!d) return '';
    const M = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    const base = `${d.getDate()} ${M[d.getMonth()]}`;
    return includeYear ? `${base} ${d.getFullYear()}` : base;
  };

  const buildSubLabel = (g: string[]): string => {
    const sWk = g[0].split('-W')[1];
    const eWk = g[g.length - 1].split('-W')[1];
    const mon = getWkMonday(g[0]);
    const fri = getWkMonday(g[g.length - 1]);
    if (fri) fri.setDate(fri.getDate() + 4);

    let dateRange = '';
    if (mon && fri) {
      if (mon.getFullYear() === fri.getFullYear()) {
        dateRange = `${fmtShort(mon)} – ${fmtShort(fri)} ${fri.getFullYear()}`;
      } else {
        dateRange = `${fmtShort(mon, true)} – ${fmtShort(fri, true)}`;
      }
    }

    if (g.length === 1) return `Sett. ${sWk}  ·  ${dateRange}`;
    return `Sett. ${sWk} → ${eWk}  ·  ${dateRange}`;
  };

  const computeSubperiods = (
    percentuali: Record<string, number>,
    allWeekIds: string[]
  ): SubPeriod[] => {
    // Filtriamo solo le settimane che hanno effettivamente un'assegnazione
    const relevantWeeks = allWeekIds.filter(wkId => wkId in percentuali);
    if (relevantWeeks.length === 0) return [];

    const periods: SubPeriod[] = [];
    let currentGroup: string[] = [relevantWeeks[0]];
    let currentPct = percentuali[relevantWeeks[0]];

    for (let i = 1; i < relevantWeeks.length; i++) {
      const wkId = relevantWeeks[i];
      const pct = percentuali[wkId];

      // Verifica se questa settimana è consecutiva alla precedente nel range globale
      const prevWkId = relevantWeeks[i - 1];
      const prevIdxInAll = allWeekIds.indexOf(prevWkId);
      const currIdxInAll = allWeekIds.indexOf(wkId);
      const isConsecutive = currIdxInAll === prevIdxInAll + 1;

      if (pct === currentPct && isConsecutive) {
        // Stesso blocco
        currentGroup.push(wkId);
      } else {
        // Nuovo blocco: salva il precedente
        periods.push({ weekIds: [...currentGroup], pct: currentPct, label: buildSubLabel(currentGroup) });
        currentGroup = [wkId];
        currentPct = pct;
      }
    }

    // Salva l'ultimo gruppo
    periods.push({ weekIds: [...currentGroup], pct: currentPct, label: buildSubLabel(currentGroup) });

    return periods;
  };

  // ===========================================================
  // Handler: Modifica la percentuale di un SINGOLO sotto-periodo
  // (non tocca le settimane fuori dal blocco)
  // ===========================================================
  const handleLocalAssignSubperiod = (
    resName: string,
    commessaId: string,
    weekIds: string[], // solo le settimane di questo blocco
    newPercentage: number
  ) => {
    const commObj = commesse.find(c => c.id === commessaId);
    if (!commObj) return;

    const baseDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
    const newDraft = { ...draftAssignments };

    for (const wkId of weekIds) {
      if (isResourceOnFullWeekLeave(resName, wkId)) {
        showToast(`${resName} è in ferie/assenza per la settimana ${wkId.split('-W')[1]}.`, 'warning');
        continue;
      }
      const docId = `${resName}-${wkId}`;
      const currentList = newDraft[docId] || [];
      const filteredList = currentList.filter((a: any) => a.commessaId !== commessaId);

      // Calcola i giorni lavorativi coperti da questo weekId nel range selezionato
      const coveredDays = getCoveredDaysInWeek(wkId, allocDataInizio, allocDataFine);
      if (coveredDays === 0) continue;

      const allowedDays: string[] = [];
      for (const day of baseDays) {
        const dayDate = getWeekdayDate(wkId, day);
        if (dayDate >= allocDataInizio && dayDate <= allocDataFine) {
          allowedDays.push(day);
        }
      }

      const newAllocation = {
        commessaId: commessaId,
        commessaName: commObj.nome,
        percentuale: newPercentage,
        colore: TIPOLOGIA_COLORS[commObj.tipologia || ''] || commObj.colore || '#3b82f6',
        giorni: allowedDays.length > 0 ? allowedDays : baseDays
      };

      newDraft[docId] = [...filteredList, newAllocation];
    }

    setDraftAssignments(newDraft);
    setHasChanges(true);
  };

  // ===========================================================
  // Handler: Rimuove un SINGOLO sotto-periodo dalla commessa
  // (non tocca le settimane fuori dal blocco)
  // ===========================================================
  const handleLocalRemoveSubperiod = (
    resName: string,
    commessaId: string,
    weekIds: string[]
  ) => {
    const newDraft = { ...draftAssignments };

    for (const wkId of weekIds) {
      const docId = `${resName}-${wkId}`;
      const currentList = newDraft[docId] || [];
      const filteredList = currentList.filter((a: any) => a.commessaId !== commessaId);

      if (filteredList.length === 0) {
        delete newDraft[docId];
      } else {
        newDraft[docId] = filteredList;
      }
    }

    setDraftAssignments(newDraft);
    setHasChanges(true);
  };

  // Aggiorna Bozza Locale per Assegnazione Risorsa -> Commessa
  const handleLocalAssignResourceToCommessa = (resName: string, commessaId: string, percentage: number) => {
    if (!allocDataInizio || !allocDataFine || !resName || !commessaId) return;
    const commObj = commesse.find(c => c.id === commessaId);
    if (!commObj) return;

    const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
    
    for (const wkId of targetWeekIds) {
      if (isResourceOnFullWeekLeave(resName, wkId)) {
        showToast(`Impossibile assegnare commessa: ${resName} è in ferie/assenza per l'intera settimana (${wkId}).`, 'warning');
        return;
      }
    }

    const baseDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
    const newDraft = { ...draftAssignments };

    for (const wkId of targetWeekIds) {
      const docId = `${resName}-${wkId}`;
      const coveredDays = getCoveredDaysInWeek(wkId, allocDataInizio, allocDataFine);
      if (coveredDays === 0) continue;

      const allowedDays: string[] = [];
      for (const day of baseDays) {
        const dayDate = getWeekdayDate(wkId, day);
        if (dayDate >= allocDataInizio && dayDate <= allocDataFine) {
          allowedDays.push(day);
        }
      }

      const currentList = newDraft[docId] || [];
      const filteredList = currentList.filter((a: any) => a.commessaId !== commessaId);
      
      const newAllocation = {
        commessaId: commessaId,
        commessaName: commObj.nome,
        percentuale: percentage,
        colore: TIPOLOGIA_COLORS[commObj.tipologia || ''] || commObj.colore || '#3b82f6',
        giorni: allowedDays
      };

      newDraft[docId] = [...filteredList, newAllocation];
    }

    setDraftAssignments(newDraft);
    setHasChanges(true);
  };

  // Aggiorna Bozza Locale per Rimozione Risorsa da Commessa
  const handleLocalRemoveResourceFromCommessa = (resName: string, commessaId: string) => {
    if (!allocDataInizio || !allocDataFine || !resName || !commessaId) return;
    const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
    const newDraft = { ...draftAssignments };

    for (const wkId of targetWeekIds) {
      const docId = `${resName}-${wkId}`;
      const currentList = newDraft[docId] || [];
      const filteredList = currentList.filter((a: any) => a.commessaId !== commessaId);

      if (filteredList.length === 0) {
        delete newDraft[docId];
      } else {
        newDraft[docId] = filteredList;
      }
    }

    setDraftAssignments(newDraft);
    setHasChanges(true);
  };

  // Aggiorna Bozza Locale per Sostituzione Risorsa
  const handleLocalSubstitution = () => {
    if (!selectedCommessaId || !sourceResource || !targetResource) return;
    if (sourceResource === targetResource) return;

    const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
    const commObj = commesse.find(c => c.id === selectedCommessaId);
    const newDraft = { ...draftAssignments };

    for (const wkId of targetWeekIds) {
      const docIdA = `${sourceResource}-${wkId}`;
      const currentListA = newDraft[docIdA] || [];
      const oldAlloc = currentListA.find((a: any) => a.commessaId === selectedCommessaId);
      if (!oldAlloc) continue;

      // Rimuovi da A
      const updatedListA = currentListA.filter((a: any) => a.commessaId !== selectedCommessaId);
      if (updatedListA.length === 0) {
        delete newDraft[docIdA];
      } else {
        newDraft[docIdA] = updatedListA;
      }

      // Assegna a B
      const docIdB = `${targetResource}-${wkId}`;
      const currentListB = newDraft[docIdB] || [];
      const filteredListB = currentListB.filter((a: any) => a.commessaId !== selectedCommessaId);
      const newAllocB = {
        ...oldAlloc,
        commessaName: commObj?.nome || oldAlloc.commessaName
      };
      newDraft[docIdB] = [...filteredListB, newAllocB];
    }

    setDraftAssignments(newDraft);
    setHasChanges(true);
  };

  // Salva Definitivo su Firestore e chiudi la modale
  const handleSaveAllChanges = async () => {
    setLoading(true);
    try {
      const batch = writeBatch(db);
      const allKeys = new Set([...Object.keys(draftAssignments), ...Object.keys(assegnazioni)]);
      let writeCount = 0;

      allKeys.forEach(key => {
        const currentList = draftAssignments[key] || [];
        const dbList = assegnazioni[key] || [];

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

          // Notifiche
          const parts = key.split('-');
          if (parts.length >= 3) {
            const resName = parts.slice(0, -2).join('-');
            const wkId = parts.slice(-2).join('-');
            const targetDip = dipendenti.find(d => d.nome === resName);
            const isSelfRes = (targetDip?.email?.toLowerCase() === (userEmail || '').toLowerCase()) || areNamesEqual(resName, myAssociatedName || undefined);
            if (targetDip && targetDip.email && !isSelfRes) {
              const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
              addPendingNotification(resName, targetDip.email, wkLabel, `Aggiornate assegnazioni commessa`, userEmail || undefined, myAssociatedName || undefined);
            }
          }
        }
      });

      // Salva Priorità Commessa se modificata
      if (selectedCommessaId && selectedStartWeekId && selectedPriority !== initialPriority) {
        const prioDocRef = doc(db, 'priorita_commesse', `${selectedCommessaId}_${selectedStartWeekId}`);
        if (selectedPriority === 'Standard') {
          batch.delete(prioDocRef);
        } else {
          batch.set(prioDocRef, {
            commessaId: selectedCommessaId,
            weekId: selectedStartWeekId,
            priorita: selectedPriority,
            updatedAt: new Date().toISOString(),
            updatedBy: userEmail
          });
        }
        writeCount++;
      }

      if (writeCount > 0) {
        await batch.commit();
      }

      showToast("Modifiche salvate con successo!", "success");
      setTimeout(() => {
        onClose();
      }, 350);
    } catch (err) {
      console.error("Errore salvataggio definitivo:", err);
      showToast("Errore durante il salvataggio delle modifiche.", "error");
    } finally {
      setLoading(false);
    }
  };

  const selectedCommessaObj = useMemo(() => commesse.find(c => c.id === selectedCommessaId), [commesse, selectedCommessaId]);
  const selectedResourceObj = useMemo(() => dipendenti.find(d => d.nome === selectedResourceForTab), [dipendenti, selectedResourceForTab]);
  const selectedWeekOptObj = useMemo(() => selectableWeekOptions.find(o => o.id === selectedStartWeekId), [selectableWeekOptions, selectedStartWeekId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/60 backdrop-blur-xs animate-fade-in">
      <div className="relative w-full max-w-4xl max-h-[92vh] bg-gradient-to-br from-indigo-50/90 via-white to-blue-50/90 rounded-3xl shadow-2xl border border-indigo-100/80 flex flex-col overflow-hidden">
        
        {/* Toast Notifiche */}
        {toast && (
          <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl shadow-xl font-extrabold text-xs flex items-center gap-2 transition-all ${
            toast.type === 'success' ? 'bg-emerald-600 text-white' : toast.type === 'warning' ? 'bg-amber-500 text-white' : 'bg-red-600 text-white'
          }`}>
            {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            <span>{toast.message}</span>
          </div>
        )}

        {/* HEADER MODALE */}
        <div className="flex items-center justify-between p-5 border-b border-indigo-100 bg-white/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-indigo-950 flex items-center gap-2">
                <span>Modifica Pianificazione</span>
                {isLockedContext && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-extrabold bg-indigo-100 text-indigo-800 px-2.5 py-0.5 rounded-md border border-indigo-200">
                    <Lock className="w-3 h-3 text-indigo-600" /> Contesto Bloccato
                  </span>
                )}
              </h3>
              <p className="text-[11px] font-semibold text-gray-500">
                Gestisci le assegnazioni e premi &quot;Salva Modifiche&quot; in fondo per confermare
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* CONTENUTO PRINCIPALE SCROLLABILE */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 flex flex-col gap-5">
          
          {/* TAB BAR (Mostrata SOLO se NON è contesto bloccato) */}
          {!isLockedContext && (
            <div className="flex flex-wrap border-b border-indigo-100/80 gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('commessa')}
                className={`px-4 py-2.5 font-extrabold text-xs sm:text-sm rounded-t-xl transition-all flex items-center gap-2 cursor-pointer ${
                  activeTab === 'commessa'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-indigo-800 hover:bg-indigo-100/60'
                }`}
              >
                <Briefcase className="w-4 h-4" />
                <span>Gestione per Commessa</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('risorsa')}
                className={`px-4 py-2.5 font-extrabold text-xs sm:text-sm rounded-t-xl transition-all flex items-center gap-2 cursor-pointer ${
                  activeTab === 'risorsa'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-indigo-800 hover:bg-indigo-100/60'
                }`}
              >
                <User className="w-4 h-4" />
                <span>Gestione per Risorsa</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('sostituisci')}
                className={`px-4 py-2.5 font-extrabold text-xs sm:text-sm rounded-t-xl transition-all flex items-center gap-2 cursor-pointer ${
                  activeTab === 'sostituisci'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-indigo-800 hover:bg-indigo-100/60'
                }`}
              >
                <ArrowRightLeft className="w-4 h-4" />
                <span>Sostituzione Risorsa</span>
              </button>
            </div>
          )}

          {/* TAB 1: GESTIONE PER COMMESSA */}
          {activeTab === 'commessa' && (
            <div className="flex flex-col gap-5">
              
              {/* SCHEDA CONTESTO COMMESSA & PERIODO */}
              <div className="bg-white/90 p-4 rounded-2xl border border-indigo-100 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-150 text-indigo-700 flex items-center justify-center font-black text-sm shrink-0">
                    📁
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-extrabold text-indigo-600 tracking-wider">Commessa Selezionata</span>
                    <h4 className="text-sm font-black text-gray-900 leading-tight">
                      {selectedCommessaObj ? selectedCommessaObj.nome : 'Nessuna commessa'}
                    </h4>
                    {selectedCommessaObj?.cliente && (
                      <span className="text-[11px] font-semibold text-gray-500">
                        Cliente: {selectedCommessaObj.cliente}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {/* Badge Settimana/Data Bloccata */}
                  <div className="bg-indigo-50/80 border border-indigo-100 px-3.5 py-2 rounded-xl flex items-center gap-2 shrink-0">
                    <CalendarDays className="w-4 h-4 text-indigo-600" />
                    <div className="flex flex-col">
                      <span className="text-[9.5px] uppercase font-black text-indigo-800 tracking-wider">Settimana Pianificata</span>
                      <span className="text-xs font-black text-indigo-950">
                        {selectedWeekOptObj ? selectedWeekOptObj.label : `Settimana ${initialWeekId}`}
                      </span>
                    </div>
                  </div>

                  {/* Selettore Priorità Commessa per la Settimana */}
                  {selectedCommessaId && selectedStartWeekId === selectedEndWeekId && (
                    <div className="bg-amber-50/90 border border-amber-200 px-3 py-1.5 rounded-xl flex items-center gap-2 shrink-0 shadow-2xs">
                      <div className="flex flex-col">
                        <span className="text-[9.5px] uppercase font-black text-amber-900 tracking-wider">Priorità Commessa</span>
                        <select
                          value={selectedPriority}
                          onChange={(e) => {
                            const val = e.target.value as 'Alta' | 'Standard' | 'Bassa';
                            setSelectedPriority(val);
                            setHasChanges(true);
                          }}
                          className="mt-0.5 p-1 bg-white border border-amber-300 rounded-lg text-xs font-black text-amber-950 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                        >
                          <option value="Standard">Standard</option>
                          <option value="Alta">🔴 Alta</option>
                          <option value="Bassa">🔵 Bassa</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* CARD UNIFICATA RISORSE ASSEGNATE ALLA COMMESSA */}
              <div className="bg-white/90 p-5 rounded-2xl border border-indigo-100 shadow-xs flex flex-col gap-4">
                
                {/* RIGA AGGIUNTA RAPIDA RISORSA (Sempre attiva in Gestione per Commessa) */}
                <div className="bg-indigo-50/50 p-3.5 rounded-xl border border-indigo-100 flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-[10px] uppercase font-extrabold text-indigo-900 mb-1">Aggiungi Risorsa a questa Commessa</label>
                    <select
                      value={addResourceName}
                      onChange={e => setAddResourceName(e.target.value)}
                      className="w-full h-[38px] p-2 border border-indigo-150 bg-white rounded-lg text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                    >
                      <option value="">-- Seleziona Risorsa da assegnare --</option>
                      {risorseNonAssegnateAllaCommessa.map(d => {
                        const isFullLeave = isResourceOnFullWeekLeave(d.nome, selectedStartWeekId);
                        return (
                          <option key={d.id} value={d.nome} disabled={isFullLeave} className={isFullLeave ? 'text-gray-400 font-normal italic' : ''}>
                            {d.nome} {d.macroArea ? `(${d.macroArea})` : ''} {isFullLeave ? '🏖️ (In ferie tutta la settimana)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="w-28 shrink-0">
                    <label className="block text-[10px] uppercase font-extrabold text-indigo-900 mb-1">Impegno</label>
                    <select
                      value={addResourcePercentage}
                      onChange={e => setAddResourcePercentage(e.target.value)}
                      className="w-full h-[38px] p-2 border border-indigo-150 bg-white rounded-lg text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                    >
                      {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                        <option key={pct} value={pct}>{pct}%</option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    disabled={!addResourceName}
                    onClick={() => {
                      handleLocalAssignResourceToCommessa(addResourceName, selectedCommessaId, parseInt(addResourcePercentage));
                      setAddResourceName('');
                    }}
                    className="h-[38px] flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-4 rounded-lg transition shadow-xs active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Aggiungi Risorsa</span>
                  </button>
                </div>

                {/* LISTA RISORSE ATTIUAMENTE ASSEGNATE */}
                <div>
                  <h4 className="font-bold text-xs uppercase tracking-wider text-indigo-900 border-b border-indigo-100 pb-2 mb-3 flex items-center justify-between">
                    <span>👥 Risorse Assegnate a questa Commessa</span>
                    <span className="bg-indigo-100 text-indigo-800 font-extrabold text-[10px] px-2.5 py-0.5 rounded-full">
                      {risorseAssegnateAllaCommessa.length}
                    </span>
                  </h4>

                  {/* Calcola le settimane del range selezionato in ordine, necessario per computeSubperiods */}
                  {(() => {
                    const allWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
                    return (
                      <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                        {risorseAssegnateAllaCommessa.length === 0 ? (
                          <p className="text-xs text-gray-400 italic p-4 text-center border border-dashed border-gray-200 rounded-xl">
                            Nessuna risorsa assegnata a questa commessa per il periodo selezionato.
                          </p>
                        ) : (
                          risorseAssegnateAllaCommessa.map(r => {
                            const dipObj = filteredDipendenti.find(d => d.nome === r.nome);
                            const isOwnArea = isAdmin || isDev || isSoci(myAssociatedName) || isPmOfSelectedCommessa;

                            // Calcola i sotto-periodi per questa risorsa
                            const subperiods = computeSubperiods(r.percentuali, allWeekIds);

                            // Riepilogo impegno per header card
                            const pcts = Object.values(r.percentuali);
                            const minPct = pcts.length > 0 ? Math.min(...pcts) : 0;
                            const maxPct = pcts.length > 0 ? Math.max(...pcts) : 0;
                            const displayPct = minPct === maxPct ? `${minPct}%` : `${minPct}% – ${maxPct}%`;

                            const isExpanded = expandedResources.has(r.nome);
                            const totalWeeks = Object.keys(r.percentuali).length;

                            // Badge colore area
                            const areaBadgeColors: Record<string, string> = {
                              'Disegnatori': 'bg-teal-50 text-teal-700 border-teal-100',
                              'Ingegneria': 'bg-indigo-50 text-indigo-700 border-indigo-100',
                              'Sicurezza Cantieri': 'bg-emerald-50 text-emerald-700 border-emerald-100',
                              'Consulenza Sicurezza': 'bg-amber-50 text-amber-700 border-amber-100',
                              'Amministrazione': 'bg-blue-50 text-blue-700 border-blue-100',
                            };
                            const areaBadge = dipObj?.macroArea
                              ? (areaBadgeColors[dipObj.macroArea] || 'bg-slate-50 text-slate-700 border-slate-100')
                              : '';

                            // Se vi è un solo periodo / singola settimana, mostra la riga diretta senza fisarmonica espandibile o etichetta "1 sett."
                            if (subperiods.length <= 1) {
                              const singleSp = subperiods[0];
                              const currentPct = singleSp ? singleSp.pct : minPct;

                              return (
                                <div
                                  key={r.nome}
                                  className="flex items-center justify-between p-3.5 bg-white rounded-xl border border-indigo-100 shadow-2xs hover:border-indigo-200 transition"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0 truncate">
                                    <User className="w-4 h-4 text-indigo-600 shrink-0" />
                                    <span className="font-bold text-xs text-gray-900 truncate">{r.nome}</span>
                                    {dipObj?.macroArea && (
                                      <span className={`text-[9.5px] font-black px-2 py-0.5 rounded border shrink-0 ${areaBadge}`}>
                                        {dipObj.macroArea}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2.5 shrink-0">
                                    {isOwnArea ? (
                                      <>
                                        <select
                                          value={currentPct}
                                          onChange={(e) => {
                                            const newPct = parseInt(e.target.value);
                                            if (singleSp) {
                                              handleLocalAssignSubperiod(r.nome, selectedCommessaId, singleSp.weekIds, newPct);
                                            } else {
                                              handleLocalAssignResourceToCommessa(r.nome, selectedCommessaId, newPct);
                                            }
                                          }}
                                          className="p-1.5 border border-indigo-200 rounded-lg bg-indigo-50/50 hover:bg-white font-black text-xs text-indigo-900 outline-none focus:ring-2 focus:ring-indigo-400 cursor-pointer shadow-2xs"
                                          title="Modifica percentuale di carico"
                                        >
                                          {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                                            <option key={pct} value={pct}>{pct}%</option>
                                          ))}
                                        </select>

                                        <button
                                          type="button"
                                          onClick={() => handleLocalRemoveResourceFromCommessa(r.nome, selectedCommessaId)}
                                          className="text-rose-400 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                                          title="Rimuovi questa risorsa dalla commessa"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (onRequestAreaResource) {
                                            onRequestAreaResource(dipObj?.macroArea || 'Generica', selectedCommessaId, selectedStartWeekId, r.nome);
                                          }
                                        }}
                                        className="flex items-center gap-1 text-[10px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 px-2.5 py-1 rounded-lg transition cursor-pointer"
                                        title="Richiedi modifica al coordinatore di area"
                                      >
                                        ✉️ Richiedi
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div
                                key={r.nome}
                                className="rounded-xl border border-indigo-100 shadow-xs overflow-hidden"
                              >
                                {/* ---- HEADER RISORSA (cliccabile per espandere) ---- */}
                                <div
                                  className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
                                    isExpanded ? 'bg-indigo-50/70' : 'bg-white hover:bg-indigo-50/40'
                                  }`}
                                  onClick={() => toggleResourceExpanded(r.nome)}
                                >
                                  <div className="flex items-center gap-2 truncate pr-2 min-w-0">
                                    {/* Chevron expand/collapse */}
                                    <span className={`text-indigo-500 transition-transform duration-200 shrink-0 text-[10px] ${isExpanded ? 'rotate-90' : ''}`}>
                                      ▶
                                    </span>
                                    <User className="w-4 h-4 text-indigo-600 shrink-0" />
                                    <span className="font-bold text-xs text-gray-800 truncate">{r.nome}</span>
                                    {dipObj?.macroArea && (
                                      <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border shrink-0 ${areaBadge}`}>
                                        {dipObj.macroArea}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {/* Riepilogo impegno */}
                                    <span className="text-[10px] font-black text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                                      {displayPct} · {totalWeeks} sett.
                                    </span>
                                    {/* Pulsante rimuovi TUTTO il periodo (tutta la durata selezionata) */}
                                    {isOwnArea ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleLocalRemoveResourceFromCommessa(r.nome, selectedCommessaId);
                                        }}
                                        className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                                        title="Rimuovi questa risorsa da tutti i periodi selezionati"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (onRequestAreaResource) {
                                            onRequestAreaResource(dipObj?.macroArea || 'Generica', selectedCommessaId, selectedStartWeekId, r.nome);
                                          }
                                        }}
                                        className="flex items-center gap-1 text-[10px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 px-2 py-1 rounded-lg transition cursor-pointer"
                                        title="Richiedi modifica al coordinatore di area"
                                      >
                                        ✉️ Richiedi
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* ---- SOTTO-PERIODI (visibili solo se espanso) ---- */}
                                {isExpanded && (
                                  <div className="border-t border-indigo-100/70 bg-white divide-y divide-slate-50">
                                    {subperiods.length === 0 ? (
                                      <p className="text-[11px] text-gray-400 italic p-3 text-center">
                                        Nessun sotto-periodo rilevato.
                                      </p>
                                    ) : (
                                      subperiods.map((sp, spIdx) => {
                                        // Colore background della riga in base alla percentuale
                                        const bgRow = sp.pct === 0
                                          ? 'bg-slate-50'
                                          : sp.pct <= 60
                                            ? 'bg-sky-50/60'
                                            : sp.pct <= 110
                                              ? 'bg-emerald-50/60'
                                              : 'bg-rose-50/60';

                                        const pctBadge = sp.pct === 0
                                          ? 'bg-slate-100 text-slate-600'
                                          : sp.pct <= 60
                                            ? 'bg-sky-100 text-sky-800'
                                            : sp.pct <= 110
                                              ? 'bg-emerald-100 text-emerald-800'
                                              : 'bg-rose-100 text-rose-800';

                                        return (
                                          <div
                                            key={spIdx}
                                            className={`flex items-center justify-between px-4 py-2.5 gap-3 ${bgRow}`}
                                          >
                                            {/* Label periodo */}
                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                              <span className="text-slate-400 text-[10px] shrink-0">↳</span>
                                              <span className="text-[11px] font-semibold text-gray-700 truncate">
                                                {sp.label}
                                              </span>
                                              {/* Badge percentuale attuale */}
                                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 ${pctBadge}`}>
                                                {sp.pct}%
                                              </span>
                                            </div>

                                            {/* Controlli */}
                                            <div className="flex items-center gap-2 shrink-0">
                                              {isOwnArea ? (
                                                <>
                                                  {/* Select per modificare solo questo sotto-periodo */}
                                                  <select
                                                    value={sp.pct}
                                                    onChange={(e) => {
                                                      e.stopPropagation();
                                                      handleLocalAssignSubperiod(
                                                        r.nome,
                                                        selectedCommessaId,
                                                        sp.weekIds,
                                                        parseInt(e.target.value)
                                                      );
                                                    }}
                                                    className="p-1 border border-gray-200 rounded-lg bg-white font-bold text-xs text-gray-700 outline-none focus:border-indigo-400 cursor-pointer"
                                                    title="Modifica % per questo sotto-periodo"
                                                  >
                                                    {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                                                      <option key={pct} value={pct}>{pct}%</option>
                                                    ))}
                                                  </select>
                                                  {/* Elimina solo questo sotto-periodo */}
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleLocalRemoveSubperiod(r.nome, selectedCommessaId, sp.weekIds);
                                                    }}
                                                    className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded-lg transition-colors cursor-pointer"
                                                    title={`Rimuovi questo sotto-periodo (${sp.label}) dalla commessa`}
                                                  >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                  </button>
                                                </>
                                              ) : (
                                                <span className="text-[10px] text-gray-400 italic">Sola lettura</span>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })
                                    )}

                                    {/* Azione rapida: applica % uniforme all'intero periodo di questa risorsa */}
                                    {isOwnArea && subperiods.length > 1 && (
                                      <div className="flex items-center justify-between px-4 py-2 bg-indigo-50/40 gap-3">
                                        <span className="text-[10px] font-semibold text-indigo-700">
                                          📐 Applica % uniforme all'intero periodo:
                                        </span>
                                        <div className="flex items-center gap-2 shrink-0">
                                          <select
                                            defaultValue={subperiods[0]?.pct || 100}
                                            id={`uniform-pct-${r.nome}`}
                                            className="p-1 border border-indigo-200 rounded-lg bg-white font-bold text-xs text-gray-700 outline-none focus:border-indigo-400 cursor-pointer"
                                          >
                                            {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                                              <option key={pct} value={pct}>{pct}%</option>
                                            ))}
                                          </select>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const sel = document.getElementById(`uniform-pct-${r.nome}`) as HTMLSelectElement;
                                              if (!sel) return;
                                              handleLocalAssignResourceToCommessa(r.nome, selectedCommessaId, parseInt(sel.value));
                                            }}
                                            className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] px-2.5 py-1.5 rounded-lg transition cursor-pointer active:scale-95 shadow-xs"
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
                          })
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* RICHIEDI PERSONALE DA ALTRA AREA (INTEGRAZIONE INTERSETTORIALE DA POP-UP) */}
                {selectedCommessaId && selectedStartWeekId && (() => {
                  const areaButtonConfigs: Record<string, { color: string; label: string }> = {
                    'Disegnatori':          { color: 'bg-teal-600 hover:bg-teal-700',     label: '✉️ Richiedi Disegnatore' },
                    'Ingegneria':           { color: 'bg-indigo-600 hover:bg-indigo-700', label: '✉️ Richiedi Ingegnere' },
                    'Sicurezza Cantieri':   { color: 'bg-emerald-600 hover:bg-emerald-700', label: '✉️ Richiedi Risorsa Sicurezza Cantieri' },
                    'Consulenza Sicurezza': { color: 'bg-amber-600 hover:bg-amber-700',   label: '✉️ Richiedi Consulente Sicurezza' },
                    'Amministrazione':      { color: 'bg-blue-600 hover:bg-blue-700',     label: '✉️ Richiedi Risorsa Amministrativa' },
                  };
                  const MACRO_AREE = ['Disegnatori', 'Ingegneria', 'Sicurezza Cantieri', 'Consulenza Sicurezza', 'Amministrazione'];
                  const areasToShow = MACRO_AREE.filter(a => isAdmin || !myCoordinatedAreas.includes(a));
                  if (areasToShow.length === 0) return null;

                  return (
                    <div className="pt-3.5 border-t border-indigo-100/90 flex flex-col items-center gap-2">
                      <span className="w-full text-center text-[10px] font-black text-gray-400 uppercase tracking-wider mb-0.5">
                        Richiedi personale da altra area
                      </span>
                      <div className={
                        areasToShow.length >= 5 
                          ? "grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 w-full max-w-4xl mx-auto"
                          : "grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-xl mx-auto"
                      }>
                        {areasToShow.map(area => {
                          const cfg = areaButtonConfigs[area] || { color: 'bg-indigo-600 hover:bg-indigo-700', label: `✉️ Richiedi ${area}` };
                          return (
                            <button
                              key={area}
                              type="button"
                              onClick={() => {
                                if (onRequestAreaResource) {
                                  onRequestAreaResource(area, selectedCommessaId, selectedStartWeekId);
                                } else {
                                  showToast(`Richiesta aperta per ${area}`, 'warning');
                                }
                              }}
                              className={`flex items-center justify-center text-center gap-1.5 ${cfg.color} text-white px-3.5 py-2.5 rounded-xl font-extrabold text-xs shadow-xs hover:shadow-md active:scale-95 transition-all cursor-pointer w-full`}
                            >
                              <span>{cfg.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

              </div>

            </div>
          )}

          {/* TAB 2: GESTIONE PER RISORSA */}
          {activeTab === 'risorsa' && (
            <div className="flex flex-col gap-5">

              {/* SCHEDA CONTESTO RISORSA & PERIODO */}
              <div className="bg-white/90 p-4 rounded-2xl border border-indigo-100 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-150 text-indigo-700 flex items-center justify-center font-black text-sm shrink-0">
                    👤
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-extrabold text-indigo-600 tracking-wider">Risorsa Selezionata</span>
                    <h4 className="text-sm font-black text-gray-900 leading-tight">
                      {selectedResourceForTab || 'Nessuna risorsa'}
                    </h4>
                    {selectedResourceObj?.macroArea && (
                      <span className="text-[11px] font-semibold text-gray-500">
                        Macroarea: {selectedResourceObj.macroArea}
                      </span>
                    )}
                  </div>
                </div>

                {/* Badge Settimana/Data Bloccata */}
                <div className="bg-indigo-50/80 border border-indigo-100 px-3.5 py-2 rounded-xl flex items-center gap-2 shrink-0">
                  <CalendarDays className="w-4 h-4 text-indigo-600" />
                  <div className="flex flex-col">
                    <span className="text-[9.5px] uppercase font-black text-indigo-800 tracking-wider">Settimana Pianificata</span>
                    <span className="text-xs font-black text-indigo-950">
                      {selectedWeekOptObj ? selectedWeekOptObj.label : `Settimana ${initialWeekId}`}
                    </span>
                  </div>
                </div>
              </div>

              {/* CARD UNIFICATA COMMESSE ASSEGNATE ALLA RISORSA */}
              <div className="bg-white/90 p-5 rounded-2xl border border-indigo-100 shadow-xs flex flex-col gap-4">
                
                {/* RIGA AGGIUNTA RAPIDA COMMESSA (Sempre attiva per Carichi di Lavoro) */}
                <div className="bg-indigo-50/50 p-3.5 rounded-xl border border-indigo-100 flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-[10px] uppercase font-extrabold text-indigo-900 mb-1">Aggiungi Commessa a {selectedResourceForTab}</label>
                    <select
                      value={addCommessaId}
                      onChange={e => setAddCommessaId(e.target.value)}
                      className="w-full h-[38px] p-2 border border-indigo-150 bg-white rounded-lg text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                    >
                      <option value="">-- Seleziona Commessa da assegnare --</option>
                      {commesseNonAssegnateAllaRisorsa.map(c => (
                        <option key={c.id} value={c.id}>{c.nome}</option>
                      ))}
                    </select>
                  </div>

                  <div className="w-28 shrink-0">
                    <label className="block text-[10px] uppercase font-extrabold text-indigo-900 mb-1">Impegno</label>
                    <select
                      value={addCommessaPercentage}
                      onChange={e => setAddCommessaPercentage(e.target.value)}
                      className="w-full h-[38px] p-2 border border-indigo-150 bg-white rounded-lg text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                    >
                      {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                        <option key={pct} value={pct}>{pct}%</option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    disabled={!addCommessaId}
                    onClick={() => {
                      handleLocalAssignResourceToCommessa(selectedResourceForTab, addCommessaId, parseInt(addCommessaPercentage));
                      setAddCommessaId('');
                    }}
                    className="h-[38px] flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-4 rounded-lg transition shadow-xs active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Aggiungi Commessa</span>
                  </button>
                </div>

                {/* LISTA COMMESSE ATTUALMENTE ASSEGNATE */}
                <div>
                  <h4 className="font-bold text-xs uppercase tracking-wider text-indigo-900 border-b border-indigo-100 pb-2 mb-3 flex items-center justify-between">
                    <span>📁 Commesse Assegnate a {selectedResourceForTab}</span>
                    <span className="bg-indigo-100 text-indigo-800 font-extrabold text-[10px] px-2.5 py-0.5 rounded-full">
                      {commesseAssegnateAllaRisorsa.length}
                    </span>
                  </h4>

                  <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                    {commesseAssegnateAllaRisorsa.length === 0 ? (
                      <p className="text-xs text-gray-400 italic p-4 text-center border border-dashed border-gray-200 rounded-xl">
                        Nessuna commessa assegnata a {selectedResourceForTab} per la settimana selezionata.
                      </p>
                    ) : (
                      commesseAssegnateAllaRisorsa.map(c => {
                        const pcts = Object.values(c.percentuali);
                        const minPct = Math.min(...pcts);
                        const maxPct = Math.max(...pcts);
                        const displayPct = minPct === maxPct ? `${minPct}%` : `${minPct}% - ${maxPct}%`;

                        return (
                          <div key={c.id} className="flex justify-between items-center p-3 bg-white rounded-xl border border-indigo-100 shadow-2xs hover:border-indigo-200 transition">
                            <div className="flex items-center gap-2 truncate pr-2">
                              <span className="w-3 h-3 rounded-full shrink-0 shadow-2xs" style={{ backgroundColor: c.colore }}></span>
                              <span className="font-bold text-xs text-gray-850 truncate">{c.nome}</span>
                              <span className="text-[10px] font-black text-indigo-650 ml-2">Impegno: {displayPct}</span>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <select
                                value={pcts[0] || 100}
                                onChange={(e) => handleLocalAssignResourceToCommessa(selectedResourceForTab, c.id, parseInt(e.target.value))}
                                className="p-1.5 border border-gray-200 rounded-lg bg-white font-bold text-xs text-gray-700 outline-none focus:border-indigo-400"
                              >
                                {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                                  <option key={pct} value={pct}>{pct}%</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => handleLocalRemoveResourceFromCommessa(selectedResourceForTab, c.id)}
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                                title="Rimuovi questa commessa"
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

            </div>
          )}

          {/* TAB 3: SOSTITUZIONE RISORSA */}
          {activeTab === 'sostituisci' && (
            <div className="flex flex-col gap-5">
              
              <div className="bg-white/80 p-4 rounded-2xl border border-indigo-100 flex flex-col gap-3">
                <div className="font-bold text-xs uppercase tracking-wider text-indigo-900 border-b border-indigo-100 pb-1.5">
                  1. Sostituzione Risorsa
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-indigo-950 mb-1">Risorsa da Sostituire (A) *</label>
                    <select
                      value={sourceResource}
                      onChange={e => setSourceResource(e.target.value)}
                      className="w-full p-2.5 border border-indigo-100 bg-white rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                    >
                      <option value="">-- Seleziona Risorsa A --</option>
                      {filteredDipendenti.map(d => (
                        <option key={d.id} value={d.nome}>{d.nome}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-indigo-950 mb-1">Nuova Risorsa Subentrante (B) *</label>
                    <select
                      value={targetResource}
                      onChange={e => setTargetResource(e.target.value)}
                      className="w-full p-2.5 border border-indigo-100 bg-white rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                    >
                      <option value="">-- Seleziona Risorsa B --</option>
                      {filteredDipendenti.map(d => (
                        <option key={d.id} value={d.nome}>{d.nome}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!selectedCommessaId || !sourceResource || !targetResource || sourceResource === targetResource}
                  onClick={handleLocalSubstitution}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 rounded-xl transition shadow-md active:scale-95 disabled:opacity-50 cursor-pointer text-xs mt-2"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  <span>Applica Sostituzione in Bozza</span>
                </button>
              </div>

            </div>
          )}

        </div>

        {/* FOOTER AZIONI DI SALVATAGGIO */}
        <div className="p-4 bg-white/95 border-t border-indigo-100 flex items-center justify-between shadow-lg shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-extrabold text-xs rounded-xl transition cursor-pointer"
          >
            Annulla
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={handleSaveAllChanges}
            className={`px-7 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow-lg transition active:scale-95 flex items-center gap-2 cursor-pointer disabled:opacity-50 ${
              hasChanges ? 'ring-4 ring-indigo-300 animate-pulse' : ''
            }`}
          >
            <Save className="w-4 h-4" />
            <span>{loading ? 'Salvataggio in corso...' : 'Salva Modifiche'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};
