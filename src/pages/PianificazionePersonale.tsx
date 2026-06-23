import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, onSnapshot, doc, getDoc, setDoc, deleteDoc, query, where, getDocs } from 'firebase/firestore';
import { Users, Printer, ChevronLeft, ChevronRight, Save, Download, ZoomIn, ZoomOut, Trash2, Plus } from 'lucide-react';
import { getWeekNumber, getStartOfWeek, addDays } from '../utils/date';
import AssegnazioneModal from '../components/AssegnazioneModal';
import ConfirmModal from '../components/ConfirmModal';
import { addPendingNotification, getPendingNotifications, clearPendingNotifications, sendAllPendingNotifications } from '../utils/pendingNotifications';
import { isCollaboratore } from './Impostazioni';
import { TIPOLOGIA_COLORS } from '../utils/commesseIniziali';


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
  const { isAdmin, isSenior, dipendenti, commesse, myAssociatedName } = useAuth();
  
  const [commessaSearchText, setCommessaSearchText] = useState('');
  const [isCommessaDropdownOpen, setIsCommessaDropdownOpen] = useState(false);
  const [timelineWeeks, setTimelineWeeks] = useState<WeekInfo[]>([]); // weeks for the load grid
  const [gridBaseDate, setGridBaseDate] = useState<Date>(new Date());
  const [zoomWeeks, setZoomWeeks] = useState<number>(13);
  
  const weekColumnMinWidth = useMemo(() => {
    // Estimating remaining width of a container on standard screen (approx 900px)
    const containerWidth = 900;
    const calculated = Math.floor(containerWidth / zoomWeeks);
    return `${Math.max(35, Math.min(150, calculated))}px`;
  }, [zoomWeeks]);

  const isNarrow = useMemo(() => parseInt(weekColumnMinWidth) < 80, [weekColumnMinWidth]);
  const isUltraNarrow = useMemo(() => parseInt(weekColumnMinWidth) < 50, [weekColumnMinWidth]);
  
  const [assignments, setAssignments] = useState<Record<string, Assegnazione[]>>({});
  
  // Selection states for bulk allocator
  const [activeTab, setActiveTab] = useState<'commessa' | 'risorsa' | 'sostituisci'>('commessa');
  const [selectedCommessaId, setSelectedCommessaId] = useState('');
  const [selectedResourceNames, setSelectedResourceNames] = useState<string[]>([]);
  const [resourcePercentages] = useState<Record<string, string>>({});
  const [savingAllocations, setSavingAllocations] = useState(false);
  const [allocAction, setAllocAction] = useState<'assegna' | 'rimuovi' | 'sostituisci'>('assegna');
  const [sourceResource, setSourceResource] = useState('');
  const [targetResource, setTargetResource] = useState('');

  const [allocDataInizio, setAllocDataInizio] = useState('');
  const [allocDataFine, setAllocDataFine] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  // Pending notifications states
  const [pendingNotificationsCount, setPendingNotificationsCount] = useState(0);
  const [sendingNotifications, setSendingNotifications] = useState(false);

  const [commesseToRemove, setCommesseToRemove] = useState<string[]>([]);

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

  // Tab 2 selection states
  const [selectedResourceForTab, setSelectedResourceForTab] = useState<string>('');
  const [addCommessaId, setAddCommessaId] = useState<string>('');
  const [addPercentage, setAddPercentage] = useState<string>('100');
  const [assignPercentageMap, setAssignPercentageMap] = useState<Record<string, string>>({});

  // Search filter for allocator (spostato in alto)
  const [searchQuery, setSearchQuery] = useState('');

  const filteredDipendenti = useMemo(() => {
    const list = dipendenti.filter(d => {
      const clean = d.nome.toLowerCase().trim();
      const isSocio = clean === 'corbellini matteo' || clean === 'profeti andrea' || clean === 'matteo corbellini' || clean === 'andrea profeti';
      return !isSocio;
    });
    if (!searchQuery) return list;
    return list.filter(d => d.nome.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [dipendenti, searchQuery]);

  const isPMOrResponsabile = useMemo(() => {
    return commesse.some(c => c.pm === myAssociatedName || c.responsabile === myAssociatedName);
  }, [commesse, myAssociatedName]);

  const selectableCommesse = useMemo(() => {
    const openCommesse = commesse.filter(c => c.stato !== 'Chiusa');
    if (isAdmin || isSenior) return openCommesse;
    return openCommesse.filter(c => c.pm === myAssociatedName || c.responsabile === myAssociatedName);
  }, [commesse, isAdmin, isSenior, myAssociatedName]);

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

  // Collapsible sections for grid
  const [isDipendentiExpanded, setIsDipendentiExpanded] = useState(true);
  const [isCollaboratoriExpanded, setIsCollaboratoriExpanded] = useState(true);

  // Modal states for cell edits
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalData, setModalData] = useState({ dipendente: '', weekId: '', weekLabel: '', weekSub: '', currentAssignments: [] as Assegnazione[] });

  const [approvedLeaves, setApprovedLeaves] = useState<any[]>([]);

  // Load approved leaves in real-time (last 60 days to prevent infinite data load)
  useEffect(() => {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const limitDate = sixtyDaysAgo.toLocaleDateString('sv-SE');

    const q = query(
      collection(db, 'richieste_ferie'),
      where('stato', '==', 'Approvato'),
      where('dataFine', '>=', limitDate)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setApprovedLeaves(list);
    });
    return () => unsub();
  }, []);

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
          if (wDate >= curr && wDate <= last) {
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
        });
      }
    });

    return leaveDaysFound;
  };

  // Load assignments in real-time
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'assegnazioni'), (snapshot) => {
      const ass: Record<string, Assegnazione[]> = {};
      snapshot.forEach(docSnap => {
        ass[docSnap.id] = docSnap.data().lista || [];
      });
      setAssignments(ass);
    });
    return () => unsub();
  }, []);

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
      const isUserAllowed = isAdmin || isSenior || commObj.responsabile === myAssociatedName || commObj.pm === myAssociatedName;
      if (!isUserAllowed) {
        showToast("Non hai i permessi per questa commessa.", "error");
        return;
      }
    } else {
      if (!isAdmin && !isSenior) {
        showToast("Non hai i permessi per questa operazione globale.", "error");
        return;
      }
    }

    setSavingAllocations(true);
    try {
      const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);

      for (const wkId of targetWeekIds) {
        const docId = `${resName}-${wkId}`;
        const docRef = doc(db, 'assegnazioni', docId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const currentList = docSnap.data().lista || [];
          const updatedList = currentList.filter((a: any) => a.commessaId !== commessaId);
          if (currentList.length !== updatedList.length) {
            if (updatedList.length === 0) {
              await deleteDoc(docRef);
            } else {
              await setDoc(docRef, { lista: updatedList });
            }

            // Coda notifica
            const targetDip = dipendenti.find(d => d.nome === resName);
            if (targetDip && targetDip.email) {
              const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
              addPendingNotification(
                resName,
                targetDip.email,
                wkLabel,
                `Rimossa commessa: ${commObj?.nome || commessaId}`
              );
            }
          }
        }
      }
      updatePendingNotificationsCount();
      showToast("Rimozione completata con successo!", "success");
    } catch (err) {
      console.error(err);
      showToast("Si è verificato un errore durante la rimozione.", "error");
    } finally {
      setSavingAllocations(false);
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

    const isUserAllowed = isAdmin || isSenior || commObj.responsabile === myAssociatedName || commObj.pm === myAssociatedName;
    if (!isUserAllowed) {
      showToast("Non hai i permessi per questa commessa (PM/Responsabile o Admin richiesto).", "error");
      return;
    }

    setSavingAllocations(true);
    const warnings: string[] = [];

    try {
      const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);

      // Carica assenze approvate per evitare conflitti
      const qAbs = query(
        collection(db, 'richieste_ferie'),
        where('dipendenteName', '==', resName),
        where('stato', '==', 'Approvato')
      );
      const absSnap = await getDocs(qAbs);
      const blockedDates: Record<string, boolean> = {};
      absSnap.forEach(dSnap => {
        const d = dSnap.data();
        const start = d.dataInizio || d.data;
        const end = d.dataFine || d.data;
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

      for (const wkId of targetWeekIds) {
        const docId = `${resName}-${wkId}`;
        const baseDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
        const allowedDays: string[] = [];

        let basePct = percentage;
        const coveredDays = getCoveredDaysInWeek(wkId, allocDataInizio, allocDataFine);
        if (coveredDays === 0) continue;
        basePct = Math.round((basePct * coveredDays) / 5);

        const targetDayCount = Math.round(basePct / 20);
        let allocatedCount = 0;
        for (const day of baseDays) {
          if (allocatedCount >= targetDayCount) break;
          const dayDate = getWeekdayDate(wkId, day);
          const isWithinRange = (dayDate >= allocDataInizio && dayDate <= allocDataFine);
          if (isWithinRange && !blockedDates[dayDate]) {
            allowedDays.push(day);
            allocatedCount++;
          }
        }

        const actualPct = targetDayCount > 0
          ? Math.round((basePct * allowedDays.length) / targetDayCount)
          : 0;

        if (actualPct === 0) {
          const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
          warnings.push(`- ${resName} (${wkLabel}): non assegnato (assenza totale).`);
          continue;
        }

        if (actualPct < basePct) {
          const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
          warnings.push(`- ${resName} (${wkLabel}): assegnato al ${actualPct}% per assenze.`);
        }

        const docRef = doc(db, 'assegnazioni', docId);
        const docSnap = await getDoc(docRef);
        let currentList: any[] = [];
        if (docSnap.exists()) {
          currentList = docSnap.data().lista || [];
        }

        const filteredList = currentList.filter(a => a.commessaId !== commessaId);
        const newAllocation = {
          commessaId: commessaId,
          commessaName: commObj.nome,
          percentuale: actualPct,
          colore: TIPOLOGIA_COLORS[commObj.tipologia || ''] || commObj.colore || '#64748b',
          giorni: allowedDays
        };

        await setDoc(docRef, { lista: [...filteredList, newAllocation] });

        // Coda notifica
        const targetDip = dipendenti.find(d => d.nome === resName);
        if (targetDip && targetDip.email) {
          const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
          addPendingNotification(
            resName,
            targetDip.email,
            wkLabel,
            `Assegnata commessa: ${commObj.nome} (${actualPct}%)${actualPct < basePct ? ' [Percentuale ricalcolata per ferie/assenza]' : ''}`
          );
        }
      }

      updatePendingNotificationsCount();
      showToast("Assegnazione completata con successo!", "success");
      if (warnings.length > 0) {
        showToast("Operazione completata con variazioni per assenza/ferie.", "warning");
      }
    } catch (err) {
      console.error(err);
      showToast("Si è verificato un errore durante il salvataggio.", "error");
    } finally {
      setSavingAllocations(false);
    }
  };

  const handleCellClick = (dipNome: string, weekId: string, weekLabel: string, weekSub: string) => {
    const key = `${dipNome}-${weekId}`;
    setModalData({
      dipendente: dipNome,
      weekId,
      weekLabel,
      weekSub,
      currentAssignments: assignments[key] || []
    });
    setIsModalOpen(true);
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
      const isUserAllowed = isAdmin || isSenior || commObj.responsabile === myAssociatedName || commObj.pm === myAssociatedName;
      if (!isUserAllowed) {
        showToast("Non hai i permessi per pianificare risorse su questa commessa (solo Amministratori, Responsabili Senior o il PM/Responsabile specifico della commessa sono autorizzati).", "error");
        return;
      }
    } else {
      // Global removal: only Admin or Senior
      if (!isAdmin && !isSenior) {
        showToast("Non hai i permessi per eseguire questa operazione globale (solo Amministratori o Responsabili Senior possono liberare risorse o rimuovere commesse globalmente).", "error");
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

    setSavingAllocations(true);
    const warnings: string[] = [];

    try {
      const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);

      if (allocAction === 'assegna') {
        if (!commObj) return;
        const useDateRange = true;
        for (const resName of selectedResourceNames) {
          // Fetch approved leaves for this resource to avoid booking on leave days
          const qAbs = query(
            collection(db, 'richieste_ferie'),
            where('dipendenteName', '==', resName),
            where('stato', '==', 'Approvato')
          );
          const absSnap = await getDocs(qAbs);
          const blockedDates: Record<string, boolean> = {};
          absSnap.forEach(dSnap => {
            const d = dSnap.data();
            const start = d.dataInizio || d.data;
            const end = d.dataFine || d.data;
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

          for (const wkId of targetWeekIds) {
            const docId = `${resName}-${wkId}`;

            const baseDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
            const allowedDays: string[] = [];

            let basePct = Number(resourcePercentages[resName] || '100');
            
            if (useDateRange) {
              const coveredDays = getCoveredDaysInWeek(wkId, allocDataInizio, allocDataFine);
              if (coveredDays === 0) continue;
              basePct = Math.round((basePct * coveredDays) / 5);
            }

            // How many days to allocate based on basePct
            const targetDayCount = Math.round(basePct / 20);

            let allocatedCount = 0;
            for (const day of baseDays) {
              if (allocatedCount >= targetDayCount) break;
              const dayDate = getWeekdayDate(wkId, day);
              
              // Must be within date range if using date range
              const isWithinRange = !useDateRange || (dayDate >= allocDataInizio && dayDate <= allocDataFine);
              
              if (isWithinRange && !blockedDates[dayDate]) {
                allowedDays.push(day);
                allocatedCount++;
              }
            }

            // Calculate actual percentage (omitting leave days)
            const actualPct = targetDayCount > 0
              ? Math.round((basePct * allowedDays.length) / targetDayCount)
              : 0;

            if (actualPct === 0) {
              // Resource has full-week leave, skip assignment for this week
              const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
              warnings.push(`- ${resName} (${wkLabel}): non assegnato (assenza totale).`);
              continue;
            }

            if (actualPct < basePct) {
              const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
              warnings.push(`- ${resName} (${wkLabel}): assegnato solo al ${actualPct}% (invece del ${basePct}%) per giornate di assenza/ferie.`);
            }

            // Read current assignments
            const docRef = doc(db, 'assegnazioni', docId);
            const docSnap = await getDoc(docRef);
            
            let currentList: any[] = [];
            if (docSnap.exists()) {
              currentList = docSnap.data().lista || [];
            }

            // Filter out previous assignment for this commessa
            const filteredList = currentList.filter(a => a.commessaId !== selectedCommessaId);

            // Build new allocation
            const newAllocation = {
              commessaId: selectedCommessaId,
              commessaName: commObj.nome,
              percentuale: actualPct,
              colore: TIPOLOGIA_COLORS[commObj.tipologia || ''] || commObj.colore || '#64748b',
              giorni: allowedDays
            };

            const updatedList = [...filteredList, newAllocation];
            await setDoc(docRef, { lista: updatedList });

            // Coda notifica
            const targetDip = dipendenti.find(d => d.nome === resName);
            if (targetDip && targetDip.email) {
              const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
              addPendingNotification(
                resName,
                targetDip.email,
                wkLabel,
                `Assegnata commessa: ${commObj.nome} (${actualPct}%)${actualPct < basePct ? ' [Percentuale ricalcolata per ferie/assenza]' : ''}`
              );
            }
          }
        }
        showToast("Assegnazioni salvate con successo!", "success");

      } else if (allocAction === 'rimuovi') {
        const hasCommessa = !!selectedCommessaId;
        const hasResources = selectedResourceNames.length > 0;
        const hasSpecificRemove = commesseToRemove.length > 0;

        if (hasResources && hasSpecificRemove) {
          // Rimuovi SOLO le commesse selezionate nella checklist per le risorse selezionate
          for (const resName of selectedResourceNames) {
            for (const wkId of targetWeekIds) {
              const docId = `${resName}-${wkId}`;
              const docRef = doc(db, 'assegnazioni', docId);
              const docSnap = await getDoc(docRef);
              if (docSnap.exists()) {
                const currentList = docSnap.data().lista || [];
                const updatedList = currentList.filter((a: any) => !commesseToRemove.includes(a.commessaId));
                
                if (currentList.length !== updatedList.length) {
                  if (updatedList.length === 0) {
                    await deleteDoc(docRef);
                  } else {
                    await setDoc(docRef, { lista: updatedList });
                  }

                  // Nomi delle commesse rimosse
                  const removedNames = commesseToRemove
                    .map(cId => commesse.find(c => c.id === cId)?.nome || cId)
                    .join(', ');

                  // Coda notifica
                  const targetDip = dipendenti.find(d => d.nome === resName);
                  if (targetDip && targetDip.email) {
                    const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
                    addPendingNotification(
                      resName,
                      targetDip.email,
                      wkLabel,
                      `Rimosse commesse: ${removedNames}`
                    );
                  }
                }
              }
            }
          }
        } else if (hasCommessa && hasResources) {
          if (!commObj) return;
          // Flow 1: Specific Commessa and Selected Resources
          for (const resName of selectedResourceNames) {
            for (const wkId of targetWeekIds) {
              const docId = `${resName}-${wkId}`;
              const docRef = doc(db, 'assegnazioni', docId);
              const docSnap = await getDoc(docRef);
              if (docSnap.exists()) {
                const currentList = docSnap.data().lista || [];
                const updatedList = currentList.filter((a: any) => a.commessaId !== selectedCommessaId);
                
                if (currentList.length !== updatedList.length) {
                  if (updatedList.length === 0) {
                    await deleteDoc(docRef);
                  } else {
                    await setDoc(docRef, { lista: updatedList });
                  }

                  // Coda notifica
                  const targetDip = dipendenti.find(d => d.nome === resName);
                  if (targetDip && targetDip.email) {
                    const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
                    addPendingNotification(
                      resName,
                      targetDip.email,
                      wkLabel,
                      `Rimossa commessa: ${commObj?.nome || ''}`
                    );
                  }
                }
              }
            }
          }
        } else if (hasCommessa && !hasResources) {
          if (!commObj) return;
          // Flow 2: Only Commessa (Remove from ALL resources)
          for (const dip of dipendenti) {
            const resName = dip.nome;
            for (const wkId of targetWeekIds) {
              const docId = `${resName}-${wkId}`;
              const docRef = doc(db, 'assegnazioni', docId);
              const docSnap = await getDoc(docRef);
              if (docSnap.exists()) {
                const currentList = docSnap.data().lista || [];
                const updatedList = currentList.filter((a: any) => a.commessaId !== selectedCommessaId);
                
                if (currentList.length !== updatedList.length) {
                  if (updatedList.length === 0) {
                    await deleteDoc(docRef);
                  } else {
                    await setDoc(docRef, { lista: updatedList });
                  }

                  // Coda notifica
                  if (dip.email) {
                    const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
                    addPendingNotification(
                      resName,
                      dip.email,
                      wkLabel,
                      `Rimossa commessa: ${commObj?.nome || ''}`
                    );
                  }
                }
              }
            }
          }
        } else if (!hasCommessa && hasResources) {
          // Flow 3: Only Resources (Clear all assignments)
          for (const resName of selectedResourceNames) {
            for (const wkId of targetWeekIds) {
              const docId = `${resName}-${wkId}`;
              const docRef = doc(db, 'assegnazioni', docId);
              await deleteDoc(docRef);

              // Coda notifica
              const targetDip = dipendenti.find(d => d.nome === resName);
              if (targetDip && targetDip.email) {
                const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
                addPendingNotification(
                  resName,
                  targetDip.email,
                  wkLabel,
                  `Svuotato carico di lavoro (rimosse tutte le commesse)`
                );
              }
            }
          }
        }
        showToast("Rimozione completata con successo!", "success");

      } else if (allocAction === 'sostituisci') {
        if (!commObj) return;
        // Fetch approved leaves for targetResource (B)
        const qAbsB = query(
          collection(db, 'richieste_ferie'),
          where('dipendenteName', '==', targetResource),
          where('stato', '==', 'Approvato')
        );
        const absSnapB = await getDocs(qAbsB);
        const blockedDatesB: Record<string, boolean> = {};
        absSnapB.forEach(dSnap => {
          const d = dSnap.data();
          const start = d.dataInizio || d.data;
          const end = d.dataFine || d.data;
          if (start && end) {
            const [sY, sM, sD] = start.split('-').map(Number);
            const [eY, eM, eD] = end.split('-').map(Number);
            const curr = new Date(sY, sM - 1, sD);
            const last = new Date(eY, eM - 1, eD);
            while (curr <= last) {
              const y = curr.getFullYear();
              const m = String(curr.getMonth() + 1).padStart(2, '0');
              const ds = String(curr.getDate()).padStart(2, '0');
              blockedDatesB[`${y}-${m}-${ds}`] = true;
              curr.setDate(curr.getDate() + 1);
            }
          }
        });

        for (const wkId of targetWeekIds) {
          const docIdA = `${sourceResource}-${wkId}`;
          const docRefA = doc(db, 'assegnazioni', docIdA);
          const docSnapA = await getDoc(docRefA);
          let currentListA: any[] = [];
          if (docSnapA.exists()) {
            currentListA = docSnapA.data().lista || [];
          }

          const oldAlloc = currentListA.find((a: any) => a.commessaId === selectedCommessaId);
          if (!oldAlloc) {
            // Resource A didn't have this commessa assigned for this week, skip
            continue;
          }

          // Remove allocation from A
          const updatedListA = currentListA.filter((a: any) => a.commessaId !== selectedCommessaId);
          if (updatedListA.length === 0) {
            await deleteDoc(docRefA);
          } else {
            await setDoc(docRefA, { lista: updatedListA });
          }

          // Copy and adjust percentage/days for B (targetResource)
          const basePct = oldAlloc.percentuale;
          const baseDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
          const allowedDaysB: string[] = [];

          const targetDayCount = Math.round(basePct / 20);
          let allocatedCount = 0;
          for (const day of baseDays) {
            if (allocatedCount >= targetDayCount) break;
            const dayDate = getWeekdayDate(wkId, day);
            const isWithinRange = (dayDate >= allocDataInizio && dayDate <= allocDataFine);
            if (isWithinRange && !blockedDatesB[dayDate]) {
              allowedDaysB.push(day);
              allocatedCount++;
            }
          }

          const actualPctB = targetDayCount > 0
            ? Math.round((basePct * allowedDaysB.length) / targetDayCount)
            : 0;
          const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;

          if (actualPctB > 0) {
            const docIdB = `${targetResource}-${wkId}`;
            const docRefB = doc(db, 'assegnazioni', docIdB);
            const docSnapB = await getDoc(docRefB);
            let currentListB: any[] = [];
            if (docSnapB.exists()) {
              currentListB = docSnapB.data().lista || [];
            }
            
            const filteredListB = currentListB.filter((a: any) => a.commessaId !== selectedCommessaId);
            const newAllocationB = {
              commessaId: selectedCommessaId,
              commessaName: commObj.nome,
              percentuale: actualPctB,
              colore: TIPOLOGIA_COLORS[commObj.tipologia || ''] || commObj.colore || '#64748b',
              giorni: allowedDaysB
            };
            const updatedListB = [...filteredListB, newAllocationB];
            await setDoc(docRefB, { lista: updatedListB });

            if (actualPctB < basePct) {
              warnings.push(`- ${targetResource} (${wkLabel}): assegnato solo al ${actualPctB}% (invece del ${basePct}%) per giornate di assenza/ferie.`);
            }
          } else {
            warnings.push(`- ${targetResource} (${wkLabel}): non assegnato (assenza totale).`);
          }

          // Coda notifica A
          const targetDipA = dipendenti.find(d => d.nome === sourceResource);
          if (targetDipA && targetDipA.email) {
            addPendingNotification(
              sourceResource,
              targetDipA.email,
              wkLabel,
              `Sostituito da ${targetResource} per la commessa ${commObj.nome}`
            );
          }

          // Coda notifica B
          const targetDipB = dipendenti.find(d => d.nome === targetResource);
          if (targetDipB && targetDipB.email) {
            addPendingNotification(
              targetResource,
              targetDipB.email,
              wkLabel,
              `Assegnato alla commessa ${commObj.nome} in sostituzione di ${sourceResource} (${actualPctB}%)${actualPctB < basePct ? ' [Percentuale ricalcolata per ferie/assenza]' : ''}`
            );
          }
        }
        showToast("Sostituzione completata con successo!", "success");
      }

      updatePendingNotificationsCount();
      // Reset selection states
      setSelectedResourceNames([]);
      setAllocDataInizio('');
      setAllocDataFine('');
      setSourceResource('');
      setTargetResource('');
      setSelectedCommessaId('');
      setCommessaSearchText('');

      if (warnings.length > 0) {
        showToast("Operazione completata con alcune variazioni (assenza/ferie).", "warning");
      }
    } catch (err) {
      console.error("Errore salvataggio:", err);
      showToast("Si è verificato un errore durante il salvataggio.", "error");
    } finally {
      setSavingAllocations(false);
    }
  };





  const filteredGridDipendenti = useMemo(() => {
    if (!gridSearchQuery) return dipendenti;
    return dipendenti.filter(d => d.nome.toLowerCase().includes(gridSearchQuery.toLowerCase()));
  }, [dipendenti, gridSearchQuery]);

  const employees = useMemo(() => {
    return filteredGridDipendenti.filter(d => !isCollaboratore(d.nome, d.tipo));
  }, [filteredGridDipendenti]);

  const collaborators = useMemo(() => {
    return filteredGridDipendenti.filter(d => isCollaboratore(d.nome, d.tipo));
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
        const totalLoad = list.reduce((acc, c) => acc + Number(c.percentuale), 0);
        const leaves = getLeavesForResourceInWeek(dip.nome, wk.id);
        
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
          <span>Pianificazione del Personale e Carichi</span>
        </h2>
      </div>

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

      {/* 1. BULK ALLOCATION PANEL */}
      {(isAdmin || isSenior || isPMOrResponsabile) && (
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 p-6 sm:p-8 rounded-[2rem] border border-indigo-100 shadow-xl no-print">
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Colonna 1: Selezione Commessa e Periodo */}
              <div className="lg:col-span-1 space-y-4 bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col justify-start">
                <h4 className="font-bold text-sm text-indigo-900 border-b pb-2">1. Commessa & Periodo</h4>
                
                <div className="relative">
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
                            c.nome.toLowerCase().includes(search)
                          );
                          if (filtered.length === 0) {
                            return <div className="p-3 text-xs text-gray-450 italic font-bold">Nessuna commessa abilitata trovata</div>;
                          }
                          return filtered.map(c => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setSelectedCommessaId(c.id);
                                setCommessaSearchText(c.nome);
                                setIsCommessaDropdownOpen(false);
                              }}
                              className="w-full text-left p-3 hover:bg-indigo-50 text-xs font-semibold text-gray-700 transition-colors flex justify-between items-center cursor-pointer"
                            >
                              <span className="truncate pr-2">{c.nome}</span>
                              <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-black shrink-0">
                                {c.codiceCommessa || c.nome.split(' - ')[0]}
                              </span>
                            </button>
                          ));
                        })()}
                      </div>
                    </>
                  )}
                </div>

                {selectedCommessaId && (() => {
                  const comm = commesse.find(c => c.id === selectedCommessaId);
                  if (!comm || (!comm.dataInizio && !comm.dataFine)) return null;
                  return (
                    <div className="text-xs text-indigo-950/85 font-semibold bg-white/70 p-2.5 rounded-xl border border-indigo-100/50 flex items-center gap-1.5 shadow-sm">
                      <span>🗓️</span>
                      <span>
                        Durata commessa: <strong className="text-indigo-900">{comm.dataInizio ? formatCommDate(comm.dataInizio) : 'N/D'}</strong> - <strong className="text-indigo-900">{comm.dataFine ? formatCommDate(comm.dataFine) : 'N/D'}</strong>
                      </span>
                    </div>
                  );
                })()}

                <div className="flex flex-col gap-3 bg-indigo-50/40 p-4 rounded-xl border border-indigo-100/30">
                  <div>
                    <label className="block text-[10px] font-black text-indigo-950 uppercase tracking-wider mb-1 ml-0.5">Data Inizio</label>
                    <input 
                      type="date"
                      required
                      value={allocDataInizio}
                      onChange={e => setAllocDataInizio(e.target.value)}
                      className="w-full p-2.5 border-none bg-white rounded-xl text-xs font-bold text-gray-750 outline-none shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-indigo-950 uppercase tracking-wider mb-1 ml-0.5">Data Fine</label>
                    <input 
                      type="date"
                      required
                      value={allocDataFine}
                      onChange={e => setAllocDataFine(e.target.value)}
                      className="w-full p-2.5 border-none bg-white rounded-xl text-xs font-bold text-gray-750 outline-none shadow-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Colonna 2 & 3: Risorse Assegnate & Non Assegnate */}
              <div className="lg:col-span-2 space-y-6">
                {!selectedCommessaId || !allocDataInizio || !allocDataFine ? (
                  <div className="bg-white/50 border border-dashed border-indigo-200 rounded-2xl p-8 text-center text-xs font-bold text-indigo-900/60 flex items-center justify-center h-full min-h-[200px]">
                    ⚠️ Seleziona una commessa e un periodo di date per visualizzare e gestire le risorse assegnate.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Lista Risorse Assegnate */}
                    <div className="bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col max-h-[420px]">
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
                            const displayPct = minPct === maxPct ? `${minPct}%` : `Variabile (${minPct}%-${maxPct}%)`;
                            
                            return (
                              <div key={r.nome} className="flex justify-between items-center p-2.5 bg-white rounded-xl border border-indigo-50 shadow-sm hover:border-indigo-100 transition-colors">
                                <div className="flex flex-col gap-0.5 truncate pr-2">
                                  <span className="font-bold text-xs text-gray-850 truncate">{r.nome}</span>
                                  <span className="text-[10px] font-black text-indigo-650">{displayPct}</span>
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

                    {/* Altre Risorse (Non Assegnate) */}
                    <div className="bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col max-h-[420px]">
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
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB CONTENT: GESTIONE PER RISORSA */}
          {activeTab === 'risorsa' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Colonna 1: Selezione Risorsa e Periodo */}
              <div className="lg:col-span-1 space-y-4 bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col justify-start">
                <h4 className="font-bold text-sm text-indigo-900 border-b pb-2">1. Risorsa & Periodo</h4>
                
                <div>
                  <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Risorsa da modificare</label>
                  <select
                    value={selectedResourceForTab}
                    onChange={e => setSelectedResourceForTab(e.target.value)}
                    className="w-full p-2.5 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-750"
                  >
                    <option value="">-- Seleziona Risorsa --</option>
                    {filteredDipendenti.map(d => (
                      <option key={d.id} value={d.nome}>{d.nome}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-3 bg-indigo-50/40 p-4 rounded-xl border border-indigo-100/30">
                  <div>
                    <label className="block text-[10px] font-black text-indigo-950 uppercase tracking-wider mb-1 ml-0.5">Data Inizio</label>
                    <input 
                      type="date"
                      required
                      value={allocDataInizio}
                      onChange={e => setAllocDataInizio(e.target.value)}
                      className="w-full p-2.5 border-none bg-white rounded-xl text-xs font-bold text-gray-755 outline-none shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-indigo-950 uppercase tracking-wider mb-1 ml-0.5">Data Fine</label>
                    <input 
                      type="date"
                      required
                      value={allocDataFine}
                      onChange={e => setAllocDataFine(e.target.value)}
                      className="w-full p-2.5 border-none bg-white rounded-xl text-xs font-bold text-gray-755 outline-none shadow-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Colonna 2 & 3: Lista Assegnazioni & Form per Aggiunta */}
              <div className="lg:col-span-2 space-y-6">
                {!selectedResourceForTab || !allocDataInizio || !allocDataFine ? (
                  <div className="bg-white/50 border border-dashed border-indigo-200 rounded-2xl p-8 text-center text-xs font-bold text-indigo-900/60 flex items-center justify-center h-full min-h-[200px]">
                    ⚠️ Seleziona una risorsa e un periodo di date per visualizzare e gestire le commesse associate.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Lista Commesse Assegnate */}
                    <div className="bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col max-h-[420px]">
                      <h4 className="font-bold text-sm text-indigo-900 border-b pb-2 mb-3">
                        📁 Commesse Assegnate ({commesseAssegnateAllaRisorsa.length})
                      </h4>
                      <div className="overflow-y-auto flex-1 space-y-2 pr-1 scrollbar-thin">
                        {commesseAssegnateAllaRisorsa.length === 0 ? (
                          <p className="text-xs text-gray-405 italic p-3 text-center">Nessuna commessa assegnata nel periodo.</p>
                        ) : (
                          commesseAssegnateAllaRisorsa.map(c => {
                            const pcts = Object.values(c.percentuali);
                            const minPct = Math.min(...pcts);
                            const maxPct = Math.max(...pcts);
                            const displayPct = minPct === maxPct ? `${minPct}%` : `Variabile (${minPct}%-${maxPct}%)`;

                            // Permessi di modifica per questa commessa
                            const commObj = commesse.find(x => x.id === c.id);
                            const hasPermission = isAdmin || isSenior || (commObj && (commObj.pm === myAssociatedName || commObj.responsabile === myAssociatedName));

                            return (
                              <div key={c.id} className="flex justify-between items-center p-2.5 bg-white rounded-xl border border-indigo-50 shadow-sm hover:border-indigo-100 transition-colors">
                                <div className="flex flex-col gap-0.5 truncate pr-2">
                                  <div className="flex items-center gap-2 truncate">
                                    <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: c.colore }}></span>
                                    <span className="font-bold text-xs text-gray-850 truncate">{c.nome}</span>
                                  </div>
                                  <span className="text-[10px] font-black text-indigo-650 ml-4.5">{displayPct}</span>
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
                                            title: 'Rimozione Commessa',
                                            message: `Sei sicuro di voler rimuovere la commessa "${c.nome}" per ${selectedResourceForTab} nel periodo selezionato?`,
                                            type: 'danger',
                                            onConfirm: async () => {
                                              await executeRemoveResourceFromCommessa(selectedResourceForTab, c.id);
                                              setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                                            }
                                          });
                                        }}
                                        className="text-red-500 hover:text-red-750 hover:bg-red-55 p-1.5 rounded-lg transition-colors disabled:opacity-50"
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

                    {/* Assegna Nuova Commessa */}
                    <div className="bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col justify-start">
                      <h4 className="font-bold text-sm text-indigo-900 border-b pb-2 mb-4">
                        ➕ Assegna Commessa
                      </h4>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Seleziona Commessa</label>
                          <select
                            value={addCommessaId}
                            onChange={e => setAddCommessaId(e.target.value)}
                            className="w-full p-2.5 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-700"
                          >
                            <option value="">-- Seleziona Commessa --</option>
                            {selectableCommesse.map(c => (
                              <option key={c.id} value={c.id}>{c.nome}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Percentuale Carico</label>
                          <select
                            value={addPercentage}
                            onChange={e => setAddPercentage(e.target.value)}
                            className="w-full p-2.5 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-700"
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
                        </div>

                        <button
                          type="button"
                          disabled={savingAllocations || !addCommessaId}
                          onClick={async () => {
                            await executeAssignResourceToCommessa(selectedResourceForTab, addCommessaId, parseInt(addPercentage));
                            setAddCommessaId('');
                          }}
                          className="w-full flex items-center justify-center gap-2 bg-indigo-650 hover:bg-indigo-700 text-white font-black py-3 rounded-xl transition shadow-md active:scale-95 disabled:opacity-50 mt-2"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Conferma ed Esegui Assegnazione</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB CONTENT: SOSTITUZIONE RISORSA */}
          {activeTab === 'sostituisci' && (
            <form onSubmit={handleConfirmAssignments} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Selezione Commessa */}
                <div className="space-y-4 bg-white/60 p-5 rounded-2xl border border-indigo-100/50">
                  <h4 className="font-bold text-sm text-indigo-900 border-b pb-2">1. Commessa per Sostituzione</h4>
                  
                  <div className="relative">
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
                              c.nome.toLowerCase().includes(search)
                            );
                            if (filtered.length === 0) {
                              return <div className="p-3 text-xs text-gray-450 italic font-bold">Nessuna commessa trovata</div>;
                            }
                            return filtered.map(c => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setSelectedCommessaId(c.id);
                                  setCommessaSearchText(c.nome);
                                  setIsCommessaDropdownOpen(false);
                                }}
                                className="w-full text-left p-3 hover:bg-indigo-50 text-xs font-semibold text-gray-700 transition-colors flex justify-between items-center cursor-pointer"
                              >
                                <span className="truncate pr-2">{c.nome}</span>
                                <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-black shrink-0">
                                  {c.codiceCommessa || c.nome.split(' - ')[0]}
                                </span>
                              </button>
                            ));
                          })()}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Periodo */}
                <div className="space-y-4 bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col justify-start">
                  <h4 className="font-bold text-sm text-indigo-900 border-b pb-2">2. Periodo</h4>
                  <div className="flex flex-col gap-3 bg-indigo-50/40 p-4 rounded-xl border border-indigo-100/30">
                    <div>
                      <label className="block text-[10px] font-black text-indigo-950 uppercase tracking-wider mb-1 ml-0.5">Data Inizio</label>
                      <input 
                        type="date"
                        required
                        value={allocDataInizio}
                        onChange={e => setAllocDataInizio(e.target.value)}
                        className="w-full p-2.5 border-none bg-white rounded-xl text-xs font-bold text-gray-700 outline-none shadow-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-indigo-950 uppercase tracking-wider mb-1 ml-0.5">Data Fine</label>
                      <input 
                        type="date"
                        required
                        value={allocDataFine}
                        onChange={e => setAllocDataFine(e.target.value)}
                        className="w-full p-2.5 border-none bg-white rounded-xl text-xs font-bold text-gray-700 outline-none shadow-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* Sostituzione Risorse */}
                <div className="space-y-4 bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col justify-start">
                  <h4 className="font-bold text-sm text-indigo-900 border-b pb-2">3. Sostituzione Risorsa</h4>
                  
                  <div>
                    <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Risorsa da sostituire (A)</label>
                    <select
                      value={sourceResource}
                      onChange={e => setSourceResource(e.target.value)}
                      className="w-full p-2.5 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-700"
                    >
                      <option value="">Seleziona risorsa...</option>
                      {filteredDipendenti.map(d => (
                        <option key={d.id} value={d.nome}>{d.nome}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Nuova risorsa (B)</label>
                    <select
                      value={targetResource}
                      onChange={e => setTargetResource(e.target.value)}
                      className="w-full p-2.5 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-700"
                    >
                      <option value="">Seleziona risorsa...</option>
                      {filteredDipendenti.map(d => (
                        <option key={d.id} value={d.nome}>{d.nome}</option>
                      ))}
                    </select>
                  </div>
                </div>

              </div>

              <div className="flex justify-end">
                <button 
                  type="submit"
                  disabled={savingAllocations}
                  onClick={() => setAllocAction('sostituisci')}
                  className="flex items-center gap-2 bg-indigo-650 hover:bg-indigo-700 text-white font-black px-8 py-3.5 rounded-xl transition shadow-lg active:scale-95 disabled:opacity-50"
                >
                  <Save className="w-5 h-5" />
                  {savingAllocations ? 'Sostituzione...' : 'Conferma ed Esegui Sostituzione'}
                </button>
              </div>
            </form>
          )}

        </div>
      )}

      {/* 2. TIMELINE CARICHI DI LAVORO */}
      <div className="bg-white rounded-[2rem] shadow-xl border relative mb-10 flex flex-col max-h-[750px]">
        
        {/* Navigation Toolbar */}
        <div className="p-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4 no-print bg-gray-50/50 rounded-t-[2rem] shrink-0">
          <div>
            <h3 className="font-extrabold text-xl text-gray-900">Carichi di Lavoro Settimanali</h3>
            <p className="text-xs text-gray-400 font-bold mt-0.5">
              {(isAdmin || isSenior) 
                ? "* Clicca su una cella per aggiungere, rimuovere o modificare i dettagli delle commesse per quella settimana."
                : "* Vista di sola lettura. (Solo Amministratori o Responsabili Senior possono modificare la pianificazione)"
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

            <button onClick={() => window.print()} className="flex items-center gap-2 bg-gray-900 text-white hover:bg-gray-800 px-4 py-2.5 rounded-xl text-sm font-bold transition shadow-md active:scale-95">
              <Printer className="w-4 h-4" /> Stampa Carichi
            </button>
          </div>
        </div>

        {/* Load Grid with clipping for rounded corners */}
        <div className="w-full flex-1 overflow-hidden mb-4 rounded-b-2xl flex flex-col">
          <div className="w-full overflow-auto scrollbar-thin flex-1">
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
                      {!isNarrow && (
                        <div className="text-[11px] text-gray-400 mt-0.5 truncate">{wk.sub}</div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            {employees.length === 0 && collaborators.length === 0 ? (
              <tbody className="divide-y divide-gray-100 font-medium bg-white">
                <tr>
                  <td colSpan={timelineWeeks.length + 1} className="p-12 text-center text-gray-400 font-bold italic bg-white">
                    Nessuna risorsa corrisponde ai criteri di ricerca.
                  </td>
                </tr>
              </tbody>
            ) : (
              <>
                {/* DIPENDENTI SECTION */}
                <tbody className="divide-y divide-gray-100 font-medium bg-white">
                  {/* DIPENDENTI ACCORDION HEADER */}
                  <tr 
                    onClick={() => setIsDipendentiExpanded(!isDipendentiExpanded)} 
                    className="bg-indigo-50/40 text-indigo-900 font-extrabold text-xs cursor-pointer hover:bg-indigo-50 transition-colors select-none"
                  >
                    <td colSpan={timelineWeeks.length + 1} className="p-3 text-left pl-6 sticky left-0 z-20 border-b border-indigo-100/60 bg-indigo-50/95" style={{ top: '55px' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-indigo-500 w-3 text-center">{isDipendentiExpanded ? '▼' : '▶'}</span>
                        <span className="uppercase tracking-wider font-black">Dipendenti Interni ({employees.length})</span>
                      </div>
                    </td>
                  </tr>

                  {/* DIPENDENTI ROWS */}
                  {isDipendentiExpanded && (
                    employees.length === 0 ? (
                      <tr>
                        <td colSpan={timelineWeeks.length + 1} className="p-4 text-center text-gray-400 italic bg-white">
                          Nessun dipendente trovato.
                        </td>
                      </tr>
                    ) : (
                      employees.map(dip => (
                        <tr key={dip.id} className="hover:bg-indigo-50/20 transition-colors bg-white">
                          <td 
                            className="p-4 text-left font-bold text-gray-800 bg-white sticky left-0 z-10 shadow-[1px_0_0_0_#f3f4f6] border-b align-middle truncate"
                            style={{ width: '180px', minWidth: '180px', maxWidth: '180px' }}
                            title={dip.nome}
                          >
                            {dip.nome}
                          </td>
                          
                          {timelineWeeks.map((wk, wIndex) => {
                            const key = `${dip.nome}-${wk.id}`;
                            const list = assignments[key] || [];
                            const totalLoad = list.reduce((acc, c) => acc + Number(c.percentuale), 0);
                            const leaves = getLeavesForResourceInWeek(dip.nome, wk.id);

                            const isEditable = isAdmin || isSenior;
                            
                            let bgClass = "bg-slate-50/50 text-slate-400";
                            if (isEditable) bgClass += " hover:bg-slate-100/60";
                            let indicatorColor = "bg-gray-300";

                            if (totalLoad > 0) {
                              if (totalLoad < 100) {
                                bgClass = isEditable 
                                  ? "bg-sky-50 text-sky-800 hover:bg-sky-100/80" 
                                  : "bg-sky-50 text-sky-800";
                                indicatorColor = "bg-sky-400";
                              } else if (totalLoad === 100) {
                                bgClass = isEditable 
                                  ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100/80" 
                                  : "bg-emerald-50 text-emerald-800";
                                indicatorColor = "bg-emerald-500";
                              } else {
                                bgClass = isEditable 
                                  ? "bg-rose-50 text-rose-800 hover:bg-rose-100/90 font-black" 
                                  : "bg-rose-50 text-rose-800 font-black";
                                indicatorColor = "bg-rose-600";
                              }
                            }

                            const ferieCount = leaves.filter(l => l.tipo === 'ferie').length;
                            const malattiaCount = leaves.filter(l => l.tipo === 'malattia').length;
                            const maternitaCount = leaves.filter(l => l.tipo === 'maternita').length;
                            const permessoCount = leaves.filter(l => l.tipo === 'permesso' || l.tipo === 'mattina' || l.tipo === 'pomeriggio').length;
                            const smartCount = leaves.filter(l => l.tipo === 'smart').length;

                            return (
                              <td 
                                key={wIndex} 
                                onClick={() => isEditable && handleCellClick(dip.nome, wk.id, wk.label, wk.sub)}
                                className={`border-l border-b border-gray-100 align-middle transition-colors ${isEditable ? 'cursor-pointer' : 'cursor-default'} ${bgClass} ${
                                  isUltraNarrow ? 'p-1' : isNarrow ? 'p-1.5' : 'p-3'
                                }`}
                                style={{ minWidth: weekColumnMinWidth, width: weekColumnMinWidth }}
                              >
                                <div 
                                  className="flex flex-col items-center justify-center relative group/cell"
                                  style={{ 
                                    minHeight: isNarrow ? '40px' : '56px',
                                    gap: isUltraNarrow ? '1px' : '2px'
                                  }}
                                >
                                  <span className={`${isUltraNarrow ? 'text-[10px]' : 'text-xs'} font-black`}>{totalLoad}%</span>
                                  
                                  {!isUltraNarrow && (
                                    <span className={`w-1.5 h-1.5 rounded-full shadow-sm ${indicatorColor}`}></span>
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
                                    <div className="hidden group-hover/cell:flex absolute bottom-full mb-1 bg-gray-900 text-white text-[11px] rounded-lg p-2.5 flex-col gap-1 z-50 shadow-md min-w-[170px] pointer-events-none text-left">
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
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )
                  )}
                </tbody>

                {/* COLLABORATORI SECTION */}
                <tbody className="divide-y divide-gray-100 font-medium bg-white">
                  {/* COLLABORATORI ACCORDION HEADER */}
                  <tr 
                    onClick={() => setIsCollaboratoriExpanded(!isCollaboratoriExpanded)} 
                    className="bg-amber-50/40 text-amber-950 font-extrabold text-xs cursor-pointer hover:bg-amber-50/80 transition-colors select-none border-t border-amber-100"
                  >
                    <td colSpan={timelineWeeks.length + 1} className="p-3 text-left pl-6 sticky left-0 z-20 border-b border-amber-100 bg-amber-50/95" style={{ top: '55px' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-amber-500 w-3 text-center">{isCollaboratoriExpanded ? '▼' : '▶'}</span>
                        <span className="uppercase tracking-wider font-black">Collaboratori Esterni P. IVA ({collaborators.length})</span>
                      </div>
                    </td>
                  </tr>

                  {/* COLLABORATORI ROWS */}
                  {isCollaboratoriExpanded && (
                    collaborators.length === 0 ? (
                      <tr>
                        <td colSpan={timelineWeeks.length + 1} className="p-4 text-center text-gray-400 italic bg-white">
                          Nessun collaboratore trovato.
                        </td>
                      </tr>
                    ) : (
                      collaborators.map(dip => (
                        <tr key={dip.id} className="hover:bg-indigo-50/20 transition-colors bg-white">
                          <td 
                            className="p-4 text-left font-bold text-gray-800 bg-white sticky left-0 z-10 shadow-[1px_0_0_0_#f3f4f6] border-b align-middle truncate"
                            style={{ width: '180px', minWidth: '180px', maxWidth: '180px' }}
                            title={dip.nome}
                          >
                            {dip.nome}
                          </td>
                          
                          {timelineWeeks.map((wk, wIndex) => {
                            const key = `${dip.nome}-${wk.id}`;
                            const list = assignments[key] || [];
                            const totalLoad = list.reduce((acc, c) => acc + Number(c.percentuale), 0);
                            const leaves = getLeavesForResourceInWeek(dip.nome, wk.id);

                            const isEditable = isAdmin || isSenior;
                            
                            let bgClass = "bg-slate-50/50 text-slate-400";
                            if (isEditable) bgClass += " hover:bg-slate-100/60";
                            let indicatorColor = "bg-gray-300";

                            if (totalLoad > 0) {
                              if (totalLoad < 100) {
                                bgClass = isEditable 
                                  ? "bg-sky-50 text-sky-800 hover:bg-sky-100/80" 
                                  : "bg-sky-50 text-sky-800";
                                indicatorColor = "bg-sky-400";
                              } else if (totalLoad === 100) {
                                bgClass = isEditable 
                                  ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100/80" 
                                  : "bg-emerald-50 text-emerald-800";
                                indicatorColor = "bg-emerald-500";
                              } else {
                                bgClass = isEditable 
                                  ? "bg-rose-50 text-rose-800 hover:bg-rose-100/90 font-black" 
                                  : "bg-rose-50 text-rose-800 font-black";
                                indicatorColor = "bg-rose-600";
                              }
                            }

                            const ferieCount = leaves.filter(l => l.tipo === 'ferie').length;
                            const malattiaCount = leaves.filter(l => l.tipo === 'malattia').length;
                            const maternitaCount = leaves.filter(l => l.tipo === 'maternita').length;
                            const permessoCount = leaves.filter(l => l.tipo === 'permesso' || l.tipo === 'mattina' || l.tipo === 'pomeriggio').length;
                            const smartCount = leaves.filter(l => l.tipo === 'smart').length;

                            return (
                              <td 
                                key={wIndex} 
                                onClick={() => isEditable && handleCellClick(dip.nome, wk.id, wk.label, wk.sub)}
                                className={`border-l border-b border-gray-100 align-middle transition-colors ${isEditable ? 'cursor-pointer' : 'cursor-default'} ${bgClass} ${
                                  isUltraNarrow ? 'p-1' : isNarrow ? 'p-1.5' : 'p-3'
                                }`}
                                style={{ minWidth: weekColumnMinWidth, width: weekColumnMinWidth }}
                              >
                                <div 
                                  className="flex flex-col items-center justify-center relative group/cell"
                                  style={{ 
                                    minHeight: isNarrow ? '40px' : '56px',
                                    gap: isUltraNarrow ? '1px' : '2px'
                                  }}
                                >
                                  <span className={`${isUltraNarrow ? 'text-[10px]' : 'text-xs'} font-black`}>{totalLoad}%</span>
                                  
                                  {!isUltraNarrow && (
                                    <span className={`w-1.5 h-1.5 rounded-full shadow-sm ${indicatorColor}`}></span>
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
                                    <div className="hidden group-hover/cell:flex absolute bottom-full mb-1 bg-gray-900 text-white text-[11px] rounded-lg p-2.5 flex-col gap-1 z-50 shadow-md min-w-[170px] pointer-events-none text-left">
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
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )
                  )}
                </tbody>
              </>
            )}
          </table>
        </div>
      </div>

        {/* Legend */}
        <div className="p-4 bg-gray-50 flex flex-wrap gap-6 border-t justify-center text-xs font-bold text-gray-500 rounded-b-[2rem]">
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gray-300"></span> Carico Vuoto (0%)</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span> Sotto-utilizzato (&lt; 100%)</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500"></span> Ottimale (100%)</div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-600"></span> Sovraccarico (&gt; 100%)</div>
        </div>

      </div>

      <AssegnazioneModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        dipendente={modalData.dipendente}
        weekId={modalData.weekId}
        weekLabel={modalData.weekLabel}
        weekSub={modalData.weekSub}
        commesseCatalog={selectableCommesse}
        currentAssignments={assignments[`${modalData.dipendente}-${modalData.weekId}`] || []}
        dipendentiList={dipendenti}
        onAssignmentsChanged={updatePendingNotificationsCount}
      />

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
