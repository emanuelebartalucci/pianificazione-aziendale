import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { doc, writeBatch } from 'firebase/firestore';
import { getStartOfWeek, addDays, getWeekNumber } from '../utils/date';
import { addPendingNotification } from '../utils/pendingNotifications';
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
  return name1.toLowerCase().trim() === name2.toLowerCase().trim();
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
    userEmail = '', 
    myAssociatedName = '', 
    assegnazioni = {}
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

  // Bozza locale per modifiche non ancora salvate su Firestore
  const [draftAssignments, setDraftAssignments] = useState<Record<string, any[]>>({});
  const [hasChanges, setHasChanges] = useState(false);
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

      if (initialWeekId) {
        const matched = selectableWeekOptions.find(o => o.id === initialWeekId);
        if (matched) {
          setSelectedStartWeekId(matched.id);
          setSelectedEndWeekId(matched.id);
        }
      } else {
        setSelectedStartWeekId(currentWeekOpt.id);
        setSelectedEndWeekId(currentWeekOpt.id);
      }
    }
  }, [isOpen, initialTab, initialCommessaId, initialResourceName, initialWeekId, selectableWeekOptions, currentWeekOpt, assegnazioni]);

  // Sincronizza allocDataInizio e allocDataFine con le settimane selezionate
  useEffect(() => {
    const startOpt = selectableWeekOptions.find(o => o.id === selectedStartWeekId);
    const endOpt = selectableWeekOptions.find(o => o.id === selectedEndWeekId);

    if (startOpt && endOpt) {
      setAllocDataInizio(startOpt.mondayStr);
      setAllocDataFine(endOpt.sundayStr);
    }
  }, [selectedStartWeekId, selectedEndWeekId, selectableWeekOptions]);

  // Commesse selezionabili
  const selectableCommesse = useMemo(() => {
    return commesse.filter(c => !c.stato || c.stato !== 'Chiusa');
  }, [commesse]);

  // Dipendenti attivi
  const filteredDipendenti = useMemo(() => {
    return dipendenti.filter(d => !d.dataCessazione || d.dataCessazione > new Date().toISOString().split('T')[0]);
  }, [dipendenti]);

  // Macroaree coordinate dall'utente corrente (Coordinatori)
  const myCoordinatedAreas = useMemo(() => {
    if (!userEmail) return [];
    const myCoords = (coordinatori || []).filter(c => c.email?.toLowerCase() === userEmail.toLowerCase());
    return myCoords.map(c => c.area);
  }, [userEmail, coordinatori]);

  // Dipendenti direttamente assegnabili (Admin vedono tutti; Coordinatori/PM vedono solo la propria area)
  const selectableDipendentiForUser = useMemo(() => {
    if (isAdmin || myCoordinatedAreas.length === 0) return filteredDipendenti;
    return filteredDipendenti.filter(d => d.macroArea && myCoordinatedAreas.includes(d.macroArea));
  }, [filteredDipendenti, isAdmin, myCoordinatedAreas]);

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
    const assignedList = Object.values(assignedMap);
    const nonAssignedList = selectableDipendentiForUser.filter(d => !assignedNames.has(d.nome));

    return {
      risorseAssegnateAllaCommessa: assignedList,
      risorseNonAssegnateAllaCommessa: nonAssignedList
    };
  }, [selectedCommessaId, allocDataInizio, allocDataFine, draftAssignments, filteredDipendenti, selectableDipendentiForUser]);

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

  // Aggiorna Bozza Locale per Assegnazione Risorsa -> Commessa
  const handleLocalAssignResourceToCommessa = (resName: string, commessaId: string, percentage: number) => {
    if (!allocDataInizio || !allocDataFine || !resName || !commessaId) return;
    const commObj = commesse.find(c => c.id === commessaId);
    if (!commObj) return;

    const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
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

              {/* CARD UNIFICATA RISORSE ASSEGNATE ALLA COMMESSA */}
              <div className="bg-white/90 p-5 rounded-2xl border border-indigo-100 shadow-xs flex flex-col gap-4">
                
                {/* RIGA AGGIUNTA RAPIDA RISORSA (Sempre attiva in Gestione per Commessa) */}
                <div className="bg-indigo-50/50 p-3.5 rounded-xl border border-indigo-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-[10px] uppercase font-extrabold text-indigo-900 mb-1">Aggiungi Risorsa a questa Commessa</label>
                    <select
                      value={addResourceName}
                      onChange={e => setAddResourceName(e.target.value)}
                      className="w-full p-2 border border-indigo-150 bg-white rounded-lg text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">-- Seleziona Risorsa da assegnare --</option>
                      {risorseNonAssegnateAllaCommessa.map(d => (
                        <option key={d.id} value={d.nome}>{d.nome} {d.macroArea ? `(${d.macroArea})` : ''}</option>
                      ))}
                    </select>
                  </div>

                  <div className="w-24 shrink-0">
                    <label className="block text-[10px] uppercase font-extrabold text-indigo-900 mb-1">Impegno</label>
                    <select
                      value={addResourcePercentage}
                      onChange={e => setAddResourcePercentage(e.target.value)}
                      className="w-full p-2 border border-indigo-150 bg-white rounded-lg text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
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
                    className="self-end sm:self-auto flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-4 py-2 rounded-lg transition shadow-xs active:scale-95 disabled:opacity-50 cursor-pointer"
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

                  <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                    {risorseAssegnateAllaCommessa.length === 0 ? (
                      <p className="text-xs text-gray-400 italic p-4 text-center border border-dashed border-gray-200 rounded-xl">
                        Nessuna risorsa assegnata a questa commessa per la settimana selezionata.
                      </p>
                    ) : (
                      risorseAssegnateAllaCommessa.map(r => {
                        const dipObj = filteredDipendenti.find(d => d.nome === r.nome);
                        const isOwnArea = isAdmin || !dipObj?.macroArea || myCoordinatedAreas.includes(dipObj.macroArea);
                        const pcts = Object.values(r.percentuali);
                        const minPct = Math.min(...pcts);
                        const maxPct = Math.max(...pcts);
                        const displayPct = minPct === maxPct ? `${minPct}%` : `${minPct}% - ${maxPct}%`;

                        return (
                          <div key={r.nome} className="flex justify-between items-center p-3 bg-white rounded-xl border border-indigo-100 shadow-2xs hover:border-indigo-200 transition">
                            <div className="flex items-center gap-2 truncate pr-2">
                              <User className="w-4 h-4 text-indigo-600 shrink-0" />
                              <span className="font-bold text-xs text-gray-850 truncate">{r.nome}</span>
                              {dipObj?.macroArea && (
                                <span className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100 shrink-0">
                                  {dipObj.macroArea}
                                </span>
                              )}
                              <span className="text-[10px] font-black text-indigo-650 ml-1">Impegno: {displayPct}</span>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {isOwnArea ? (
                                <>
                                  <select
                                    value={pcts[0] || 100}
                                    onChange={(e) => handleLocalAssignResourceToCommessa(r.nome, selectedCommessaId, parseInt(e.target.value))}
                                    className="p-1.5 border border-gray-200 rounded-lg bg-white font-bold text-xs text-gray-700 outline-none focus:border-indigo-400"
                                  >
                                    {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                                      <option key={pct} value={pct}>{pct}%</option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => handleLocalRemoveResourceFromCommessa(r.nome, selectedCommessaId)}
                                    className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                                    title="Rimuovi risorsa da questa commessa"
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
                                    } else {
                                      showToast(`Richiesta inviata per la risorsa ${r.nome}`, 'warning');
                                    }
                                  }}
                                  className="flex items-center gap-1 text-[11px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 px-2.5 py-1.5 rounded-xl transition cursor-pointer shadow-xs active:scale-95"
                                  title="Questa risorsa appartiene a un'altra area. Clicca per inviare una richiesta di modifica al suo Coordinatore"
                                >
                                  <span>✉️ Richiedi Modifica</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
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
                    <div className="flex flex-wrap justify-center gap-2 pt-3.5 border-t border-indigo-100/90">
                      <span className="w-full text-center text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">
                        Richiedi personale da altra area
                      </span>
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
                            className={`flex items-center gap-1.5 ${cfg.color} text-white px-3.5 py-2 rounded-2xl font-black text-xs shadow-md active:scale-95 transition-all cursor-pointer`}
                          >
                            <span>{cfg.label}</span>
                          </button>
                        );
                      })}
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
                <div className="bg-indigo-50/50 p-3.5 rounded-xl border border-indigo-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-[10px] uppercase font-extrabold text-indigo-900 mb-1">Aggiungi Commessa a {selectedResourceForTab}</label>
                    <select
                      value={addCommessaId}
                      onChange={e => setAddCommessaId(e.target.value)}
                      className="w-full p-2 border border-indigo-150 bg-white rounded-lg text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">-- Seleziona Commessa da assegnare --</option>
                      {commesseNonAssegnateAllaRisorsa.map(c => (
                        <option key={c.id} value={c.id}>{c.nome}</option>
                      ))}
                    </select>
                  </div>

                  <div className="w-24 shrink-0">
                    <label className="block text-[10px] uppercase font-extrabold text-indigo-900 mb-1">Impegno</label>
                    <select
                      value={addCommessaPercentage}
                      onChange={e => setAddCommessaPercentage(e.target.value)}
                      className="w-full p-2 border border-indigo-150 bg-white rounded-lg text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
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
                    className="self-end sm:self-auto flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-4 py-2 rounded-lg transition shadow-xs active:scale-95 disabled:opacity-50 cursor-pointer"
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
