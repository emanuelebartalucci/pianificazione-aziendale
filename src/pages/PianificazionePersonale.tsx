import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, onSnapshot, doc, getDoc, setDoc, query, where, getDocs } from 'firebase/firestore';
import { Users, Printer, ChevronLeft, ChevronRight, Save, Download } from 'lucide-react';
import { getWeekNumber, getStartOfWeek, addDays } from '../utils/date';
import AssegnazioneModal from '../components/AssegnazioneModal';
import { queueMail } from '../utils/mailSender';
import { isCollaboratore } from './Impostazioni';

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

export default function PianificazionePersonale() {
  const { isAdmin, isSenior, dipendenti, commesse, myAssociatedName } = useAuth();
  
  const [weeks] = useState<WeekInfo[]>(() => generateWeeksExtended(new Date(), 6)); // default show 6 weeks in allocation form
  const [timelineWeeks, setTimelineWeeks] = useState<WeekInfo[]>([]); // weeks for the load grid
  const [gridBaseDate, setGridBaseDate] = useState<Date>(new Date());
  const [zoomWeeks, setZoomWeeks] = useState<number>(13);
  
  const [assignments, setAssignments] = useState<Record<string, Assegnazione[]>>({});
  
  // Selection states for bulk allocator
  const [selectedCommessaId, setSelectedCommessaId] = useState('');
  const [selectedWeekIds, setSelectedWeekIds] = useState<string[]>([]);
  const [selectedResourceNames, setSelectedResourceNames] = useState<string[]>([]);
  const [allocationPercent, setAllocationPercent] = useState('100');
  const [savingAllocations, setSavingAllocations] = useState(false);

  // Search filter for allocator
  const [searchQuery, setSearchQuery] = useState('');

  // Search filter for main grid
  const [gridSearchQuery, setGridSearchQuery] = useState('');

  // Collapsible sections for grid
  const [isDipendentiExpanded, setIsDipendentiExpanded] = useState(true);
  const [isCollaboratoriExpanded, setIsCollaboratoriExpanded] = useState(true);

  // Modal states for cell edits
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalData, setModalData] = useState({ dipendente: '', weekId: '', weekLabel: '', weekSub: '', currentAssignments: [] as Assegnazione[] });

  const [approvedLeaves, setApprovedLeaves] = useState<any[]>([]);

  // Load approved leaves in real-time
  useEffect(() => {
    const q = query(
      collection(db, 'richieste_ferie'),
      where('stato', '==', 'Approvato')
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
            let label = leave.tipo === 'ferie' ? 'Ferie' : leave.tipo === 'malattia' ? 'Malattia' : leave.tipo === 'smart' ? 'Smart' : leave.tipo;
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
    if (!selectedCommessaId) {
      alert("Seleziona una commessa!");
      return;
    }
    if (selectedWeekIds.length === 0) {
      alert("Seleziona almeno una settimana!");
      return;
    }
    if (selectedResourceNames.length === 0) {
      alert("Seleziona almeno un dipendente!");
      return;
    }
    if (!allocationPercent) {
      alert("Seleziona una percentuale!");
      return;
    }

    const commObj = commesse.find(c => c.id === selectedCommessaId);
    if (!commObj) return;

    // Permissions check
    const isUserAllowed = isAdmin || isSenior || commObj.responsabile === myAssociatedName;
    if (!isUserAllowed) {
      alert("Non hai i permessi per pianificare risorse su questa commessa (solo Amministratori, Responsabili Senior o il Responsabile specifico della commessa sono autorizzati).");
      return;
    }

    setSavingAllocations(true);
    const warnings: string[] = [];

    try {
      const pct = Number(allocationPercent);

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

        for (const wkId of selectedWeekIds) {
          const docId = `${resName}-${wkId}`;

          // Map percentage to days, checking for leaves
          const baseDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
          const allowedDays: string[] = [];

          // How many days to allocate based on selected percentage
          const targetDayCount = Math.round(pct / 20);

          let allocatedCount = 0;
          for (const day of baseDays) {
            if (allocatedCount >= targetDayCount) break;
            const dayDate = getWeekdayDate(wkId, day);
            if (!blockedDates[dayDate]) {
              allowedDays.push(day);
              allocatedCount++;
            }
          }

          // Calculate actual percentage (omitting leave days)
          const actualPct = allowedDays.length * 20;

          if (actualPct === 0) {
            // Resource has full-week leave, skip assignment for this week
            const wkObj = weeks.find(w => w.id === wkId) || { label: wkId, sub: '' };
            warnings.push(`- ${resName} (${wkObj.label}): non assegnato (assenza totale).`);
            continue;
          }

          if (actualPct < pct) {
            const wkObj = weeks.find(w => w.id === wkId) || { label: wkId, sub: '' };
            warnings.push(`- ${resName} (${wkObj.label}): assegnato solo al ${actualPct}% (invece del ${pct}%) per giornate di assenza/ferie.`);
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
            colore: commObj.colore,
            giorni: allowedDays
          };

          const updatedList = [...filteredList, newAllocation];
          await setDoc(docRef, { lista: updatedList });

          // Queue notification mail to the employee
          const targetDip = dipendenti.find(d => d.nome === resName);
          if (targetDip && targetDip.email) {
            const wkObj = weeks.find(w => w.id === wkId) || { label: wkId, sub: '' };
            const subject = `[Pianificazione] Nuova Assegnazione Commessa - ${wkObj.label}`;
            const htmlBody = `
              <p>Ciao <strong>${resName}</strong>,</p>
              <p>Sei stato assegnato alla commessa <strong>${commObj.nome}</strong> per la <strong>${wkObj.label}</strong> (${wkObj.sub}) con un carico del <strong>${actualPct}%</strong>.</p>
              ${actualPct < pct ? `<p style="color: #ea580c; font-weight: bold;">Nota: La percentuale è stata ricalcolata in quanto risultano giornate di ferie/assenza approvate in questa settimana.</p>` : ''}
              <p>Accedi alla piattaforma per visualizzare la tua pianificazione completa.</p>
            `;
            const plainText = `Ciao ${resName},\n\nSei stato assegnato alla commessa ${commObj.nome} per la settimana ${wkObj.label} con un impegno del ${actualPct}%.\n\nAccedi alla piattaforma per maggiori dettagli.`;
            await queueMail(targetDip.email.toLowerCase(), subject, htmlBody, plainText);
          }
        }
      }

      // Reset selection states
      setSelectedResourceNames([]);
      setSelectedWeekIds([]);
      if (warnings.length > 0) {
        alert("Assegnazioni salvate. Attenzione ad alcune variazioni dovute ad assenze/ferie:\n\n" + warnings.join("\n"));
      } else {
        alert("Assegnazioni salvate con successo!");
      }
    } catch (err) {
      console.error("Errore salvataggio:", err);
      alert("Si è verificato un errore durante il salvataggio.");
    } finally {
      setSavingAllocations(false);
    }
  };

  const handleSelectAllWeeks = () => {
    if (selectedWeekIds.length === weeks.length) {
      setSelectedWeekIds([]);
    } else {
      setSelectedWeekIds(weeks.map(w => w.id));
    }
  };

  const handleSelectAllResources = () => {
    if (selectedResourceNames.length === filteredDipendenti.length) {
      setSelectedResourceNames([]);
    } else {
      setSelectedResourceNames(filteredDipendenti.map(d => d.nome));
    }
  };

  const filteredDipendenti = useMemo(() => {
    if (!searchQuery) return dipendenti;
    return dipendenti.filter(d => d.nome.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [dipendenti, searchQuery]);

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

  const shiftGridPeriod = (weeksOffset: number) => {
    setGridBaseDate(prev => addDays(prev, weeksOffset * 7));
  };

  return (
    <div className="flex flex-col gap-6">
      
      {/* HEADER */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm p-4 sm:p-6 border border-white/50 no-print flex flex-col md:flex-row justify-between items-center gap-4">
        <h2 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
          <div className="p-3 bg-indigo-100 rounded-2xl"><Users className="text-indigo-600 w-8 h-8" /></div>
          <span>Pianificazione del Personale e Carichi</span>
        </h2>
      </div>

      {/* 1. BULK ALLOCATION PANEL */}
      <div className="bg-gradient-to-br from-indigo-50 to-blue-50 p-6 sm:p-8 rounded-[2rem] border border-indigo-100 shadow-xl no-print">
        <h3 className="text-xl font-extrabold text-indigo-950 mb-4 flex items-center gap-2">
          Pianificatore Multi-Risorsa / Multi-Settimana
        </h3>
        
        <form onSubmit={handleConfirmAssignments} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Commessa & Percentage */}
            <div className="space-y-4 bg-white/60 p-5 rounded-2xl border border-indigo-100/50">
              <h4 className="font-bold text-sm text-indigo-900 border-b pb-2">1. Dettagli Assegnazione</h4>
              <div>
                <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Commessa da assegnare</label>
                <select 
                  required
                  value={selectedCommessaId}
                  onChange={e => setSelectedCommessaId(e.target.value)}
                  className="w-full p-2.5 border-none bg-white rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-700"
                >
                  <option value="">-- Seleziona --</option>
                  {commesse.map(c => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Percentuale Impegno</label>
                <select 
                  required
                  value={allocationPercent}
                  onChange={e => setAllocationPercent(e.target.value)}
                  className="w-full p-2.5 border-none bg-white rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-700"
                >
                  <option value="20">20% (1 Giorno/sett)</option>
                  <option value="40">40% (2 Giorni/sett)</option>
                  <option value="60">60% (3 Giorni/sett)</option>
                  <option value="80">80% (4 Giorni/sett)</option>
                  <option value="100">100% (Settimana Completa)</option>
                </select>
              </div>
            </div>

            {/* Weeks Checkboxes */}
            <div className="space-y-4 bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col">
              <div className="flex justify-between items-center border-b pb-2">
                <h4 className="font-bold text-sm text-indigo-900">2. Seleziona Settimane</h4>
                <button 
                  type="button" 
                  onClick={handleSelectAllWeeks}
                  className="text-[10px] bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-2 py-1 rounded font-bold transition"
                >
                  {selectedWeekIds.length === weeks.length ? 'Deseleziona tutto' : 'Seleziona tutto'}
                </button>
              </div>
              
              <div className="grid grid-cols-1 gap-2 overflow-y-auto max-h-[160px] pr-1 scrollbar-thin">
                {weeks.map(w => (
                  <label key={w.id} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/40 cursor-pointer text-xs font-bold text-gray-700">
                    <input 
                      type="checkbox"
                      checked={selectedWeekIds.includes(w.id)}
                      onChange={e => {
                        setSelectedWeekIds(prev => 
                          e.target.checked ? [...prev, w.id] : prev.filter(x => x !== w.id)
                        );
                      }}
                      className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-400"
                    />
                    <div>
                      <div>{w.label}</div>
                      <div className="text-[9px] text-gray-400">{w.sub}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Resources Checkboxes */}
            <div className="space-y-4 bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col">
              <div className="flex justify-between items-center border-b pb-2 gap-2">
                <h4 className="font-bold text-sm text-indigo-900 truncate">3. Seleziona Personale</h4>
                <button 
                  type="button" 
                  onClick={handleSelectAllResources}
                  className="text-[10px] bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-2 py-1 rounded font-bold transition shrink-0"
                >
                  {selectedResourceNames.length === filteredDipendenti.length ? 'Deseleziona tutto' : 'Seleziona tutto'}
                </button>
              </div>

              <div className="mb-2 shrink-0">
                <input 
                  type="text" 
                  placeholder="Filtra dipendenti..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full p-2 border-none bg-white rounded-xl text-xs outline-none focus:ring-1 focus:ring-indigo-400 shadow-inner font-semibold"
                />
              </div>
              
              <div className="grid grid-cols-1 gap-2 overflow-y-auto max-h-[120px] pr-1 scrollbar-thin">
                {filteredDipendenti.map(d => (
                  <label key={d.id} className="flex items-center gap-2 p-1 rounded hover:bg-white/40 cursor-pointer text-xs font-bold text-gray-700">
                    <input 
                      type="checkbox"
                      checked={selectedResourceNames.includes(d.nome)}
                      onChange={e => {
                        setSelectedResourceNames(prev => 
                          e.target.checked ? [...prev, d.nome] : prev.filter(x => x !== d.nome)
                        );
                      }}
                      className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-400"
                    />
                    <span className="truncate">{d.nome}</span>
                  </label>
                ))}
              </div>
            </div>

          </div>

          <div className="flex justify-end">
            <button 
              type="submit"
              disabled={savingAllocations}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black px-8 py-3.5 rounded-xl transition shadow-lg active:scale-95 disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {savingAllocations ? 'Salvataggio...' : 'Conferma ed Esegui Assegnazione'}
            </button>
          </div>
        </form>
      </div>

      {/* 2. TIMELINE CARICHI DI LAVORO */}
      <div className="bg-white rounded-[2rem] shadow-xl border relative mb-10 flex flex-col max-h-[750px]">
        
        {/* Navigation Toolbar */}
        <div className="p-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4 no-print bg-gray-50/50 rounded-t-[2rem] shrink-0">
          <div>
            <h3 className="font-extrabold text-xl text-gray-900">Carichi di Lavoro Settimanali</h3>
            <p className="text-xs text-gray-400 font-bold mt-0.5">* Clicca su una cella per aggiungere, rimuovere o modificare i dettagli delle commesse per quella settimana.</p>
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

            {/* Grid Zoom selector */}
            <select 
              value={zoomWeeks}
              onChange={e => setZoomWeeks(Number(e.target.value))}
              className="p-2.5 border-none bg-white rounded-xl border shadow-sm font-bold text-gray-700 text-xs outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value={5}>Vista 1 Mese</option>
              <option value={13}>Vista 3 Mesi</option>
              <option value={26}>Vista 6 Mesi</option>
            </select>

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

        {/* Load Grid */}
        <div className="w-full overflow-auto scrollbar-thin flex-1">
          <table className="w-full text-center border-collapse min-w-[1100px] text-xs">
            <thead className="sticky top-0 z-30 bg-gray-100 border-b border-gray-200 font-bold text-gray-600 shadow-sm">
              <tr>
                <th className="p-4 text-left w-64 sticky left-0 top-0 z-35 bg-white shadow-[1px_0_0_0_#e5e7eb] font-extrabold">Dipendente</th>
                {timelineWeeks.map((wk, i) => {
                  const isCurrentWeek = wk.id === `${new Date().getFullYear()}-W${getWeekNumber(new Date())}`;
                  return (
                    <th key={i} className={`p-3 border-l border-b border-gray-200 min-w-[90px] sticky top-0 z-30 bg-gray-100 ${isCurrentWeek ? 'bg-indigo-50/50' : ''}`}>
                      <div className="font-extrabold text-gray-900">{wk.label}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{wk.sub}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium">
              {employees.length === 0 && collaborators.length === 0 ? (
                <tr>
                  <td colSpan={timelineWeeks.length + 1} className="p-12 text-center text-gray-400 font-bold italic bg-white">
                    Nessuna risorsa corrisponde ai criteri di ricerca.
                  </td>
                </tr>
              ) : (
                <>
                  {/* DIPENDENTI ACCORDION HEADER */}
                  <tr 
                    onClick={() => setIsDipendentiExpanded(!isDipendentiExpanded)} 
                    className="bg-indigo-50/40 text-indigo-900 font-extrabold text-xs cursor-pointer hover:bg-indigo-50 transition-colors select-none"
                  >
                    <td colSpan={timelineWeeks.length + 1} className="p-3 text-left pl-6 sticky left-0 top-[53px] z-20 border-b border-indigo-100/60 bg-indigo-50/95">
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
                          <td className="p-4 text-left font-bold text-gray-800 bg-white sticky left-0 z-10 shadow-[1px_0_0_0_#f3f4f6] border-b align-middle w-64">
                            {dip.nome}
                          </td>
                          
                          {timelineWeeks.map((wk, wIndex) => {
                            const key = `${dip.nome}-${wk.id}`;
                            const list = assignments[key] || [];
                            const totalLoad = list.reduce((acc, c) => acc + Number(c.percentuale), 0);
                            const leaves = getLeavesForResourceInWeek(dip.nome, wk.id);

                            let bgClass = "bg-slate-50/50 text-slate-400 hover:bg-slate-100/60";
                            let indicatorColor = "bg-gray-300";

                            if (totalLoad > 0) {
                              if (totalLoad < 100) {
                                bgClass = "bg-sky-50 text-sky-800 hover:bg-sky-100/80";
                                indicatorColor = "bg-sky-400";
                              } else if (totalLoad === 100) {
                                bgClass = "bg-emerald-50 text-emerald-800 hover:bg-emerald-100/80";
                                indicatorColor = "bg-emerald-500";
                              } else {
                                bgClass = "bg-rose-50 text-rose-800 hover:bg-rose-100/90 font-black";
                                indicatorColor = "bg-rose-600";
                              }
                            }

                            const ferieCount = leaves.filter(l => l.tipo === 'ferie').length;
                            const malattiaCount = leaves.filter(l => l.tipo === 'malattia').length;
                            const permessoCount = leaves.filter(l => l.tipo === 'permesso' || l.tipo === 'mattina' || l.tipo === 'pomeriggio').length;
                            const smartCount = leaves.filter(l => l.tipo === 'smart').length;

                            return (
                              <td 
                                key={wIndex} 
                                onClick={() => handleCellClick(dip.nome, wk.id, wk.label, wk.sub)}
                                className={`p-3 border-l border-b border-gray-100 align-middle transition-colors cursor-pointer ${bgClass}`}
                              >
                                <div className="flex flex-col items-center justify-center min-h-[56px] gap-1 relative group/cell">
                                  <span className="font-black text-sm">{totalLoad}%</span>
                                  
                                  {/* Color-coded load indicator dot */}
                                  <span className={`w-2 h-2 rounded-full shadow-sm ${indicatorColor}`}></span>

                                  {/* Leaves indicator */}
                                  {leaves.length > 0 && (
                                    <div className="flex gap-1 justify-center mt-1 w-full max-w-[105px] flex-wrap">
                                      {ferieCount > 0 && (
                                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-orange-100 text-orange-700 border border-orange-200" title="Ferie">
                                          🌴 {ferieCount}g
                                        </span>
                                      )}
                                      {malattiaCount > 0 && (
                                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-red-100 text-red-700 border border-red-200" title="Malattia">
                                          🤒 {malattiaCount}g
                                        </span>
                                      )}
                                      {permessoCount > 0 && (
                                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-purple-100 text-purple-700 border border-purple-200" title="Permessi / Ass. parziale">
                                          ⏱️ {permessoCount}g
                                        </span>
                                      )}
                                      {smartCount > 0 && (
                                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-indigo-100 text-indigo-700 border border-indigo-200" title="Smart Working">
                                          🏠 {smartCount}g
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  
                                  {/* Micro hover details tooltip */}
                                  {(list.length > 0 || leaves.length > 0) && (
                                    <div className="hidden group-hover/cell:flex absolute bottom-full mb-1 bg-gray-900 text-white text-[11.5px] rounded-lg p-2.5 flex-col gap-1.5 z-50 shadow-md min-w-[170px] pointer-events-none text-left">
                                      {list.map((a, idx) => (
                                        <div key={idx} className="flex justify-between items-center gap-2 border-b border-gray-800 pb-1 last:border-none last:pb-0">
                                          <span className="truncate">{a.commessaName}</span>
                                          <span className="font-extrabold text-indigo-400">{a.percentuale}%</span>
                                        </div>
                                      ))}
                                      {leaves.length > 0 && (
                                        <div className="border-t border-gray-700 pt-1.5 mt-1 flex flex-col gap-1">
                                          <span className="text-[10px] font-bold text-orange-400">Assenze/Ferie:</span>
                                          {leaves.map((l, idx) => (
                                            <div key={idx} className="flex justify-between items-center text-[10px] gap-2">
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

                  {/* COLLABORATORI ACCORDION HEADER */}
                  <tr 
                    onClick={() => setIsCollaboratoriExpanded(!isCollaboratoriExpanded)} 
                    className="bg-amber-50/40 text-amber-950 font-extrabold text-xs cursor-pointer hover:bg-amber-50/80 transition-colors select-none border-t border-amber-100"
                  >
                    <td colSpan={timelineWeeks.length + 1} className="p-3 text-left pl-6 sticky left-0 top-[53px] z-20 border-b border-amber-100 bg-amber-50/95">
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
                          <td className="p-4 text-left font-bold text-gray-800 bg-white sticky left-0 z-10 shadow-[1px_0_0_0_#f3f4f6] border-b align-middle w-64">
                            {dip.nome}
                          </td>
                          
                          {timelineWeeks.map((wk, wIndex) => {
                            const key = `${dip.nome}-${wk.id}`;
                            const list = assignments[key] || [];
                            const totalLoad = list.reduce((acc, c) => acc + Number(c.percentuale), 0);
                            const leaves = getLeavesForResourceInWeek(dip.nome, wk.id);

                            let bgClass = "bg-slate-50/50 text-slate-400 hover:bg-slate-100/60";
                            let indicatorColor = "bg-gray-300";

                            if (totalLoad > 0) {
                              if (totalLoad < 100) {
                                bgClass = "bg-sky-50 text-sky-800 hover:bg-sky-100/80";
                                indicatorColor = "bg-sky-400";
                              } else if (totalLoad === 100) {
                                bgClass = "bg-emerald-50 text-emerald-800 hover:bg-emerald-100/80";
                                indicatorColor = "bg-emerald-500";
                              } else {
                                bgClass = "bg-rose-50 text-rose-800 hover:bg-rose-100/90 font-black";
                                indicatorColor = "bg-rose-600";
                              }
                            }

                            const ferieCount = leaves.filter(l => l.tipo === 'ferie').length;
                            const malattiaCount = leaves.filter(l => l.tipo === 'malattia').length;
                            const permessoCount = leaves.filter(l => l.tipo === 'permesso' || l.tipo === 'mattina' || l.tipo === 'pomeriggio').length;
                            const smartCount = leaves.filter(l => l.tipo === 'smart').length;

                            return (
                              <td 
                                key={wIndex} 
                                onClick={() => handleCellClick(dip.nome, wk.id, wk.label, wk.sub)}
                                className={`p-3 border-l border-b border-gray-100 align-middle transition-colors cursor-pointer ${bgClass}`}
                              >
                                <div className="flex flex-col items-center justify-center min-h-[56px] gap-1 relative group/cell">
                                  <span className="font-black text-sm">{totalLoad}%</span>
                                  
                                  {/* Color-coded load indicator dot */}
                                  <span className={`w-2 h-2 rounded-full shadow-sm ${indicatorColor}`}></span>

                                  {/* Leaves indicator */}
                                  {leaves.length > 0 && (
                                    <div className="flex gap-1 justify-center mt-1 w-full max-w-[105px] flex-wrap">
                                      {ferieCount > 0 && (
                                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-orange-100 text-orange-700 border border-orange-200" title="Ferie">
                                          🌴 {ferieCount}g
                                        </span>
                                      )}
                                      {malattiaCount > 0 && (
                                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-red-100 text-red-700 border border-red-200" title="Malattia">
                                          🤒 {malattiaCount}g
                                        </span>
                                      )}
                                      {permessoCount > 0 && (
                                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-purple-100 text-purple-700 border border-purple-200" title="Permessi / Ass. parziale">
                                          ⏱️ {permessoCount}g
                                        </span>
                                      )}
                                      {smartCount > 0 && (
                                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-indigo-100 text-indigo-700 border border-indigo-200" title="Smart Working">
                                          🏠 {smartCount}g
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  
                                  {/* Micro hover details tooltip */}
                                  {(list.length > 0 || leaves.length > 0) && (
                                    <div className="hidden group-hover/cell:flex absolute bottom-full mb-1 bg-gray-900 text-white text-[11.5px] rounded-lg p-2.5 flex-col gap-1.5 z-50 shadow-md min-w-[170px] pointer-events-none text-left">
                                      {list.map((a, idx) => (
                                        <div key={idx} className="flex justify-between items-center gap-2 border-b border-gray-800 pb-1 last:border-none last:pb-0">
                                          <span className="truncate">{a.commessaName}</span>
                                          <span className="font-extrabold text-indigo-400">{a.percentuale}%</span>
                                        </div>
                                      ))}
                                      {leaves.length > 0 && (
                                        <div className="border-t border-gray-700 pt-1.5 mt-1 flex flex-col gap-1">
                                          <span className="text-[10px] font-bold text-orange-400">Assenze/Ferie:</span>
                                          {leaves.map((l, idx) => (
                                            <div key={idx} className="flex justify-between items-center text-[10px] gap-2">
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
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="p-4 bg-gray-50 flex flex-wrap gap-6 border-t justify-center text-xs font-bold text-gray-500">
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
        commesseCatalog={commesse}
        currentAssignments={assignments[`${modalData.dipendente}-${modalData.weekId}`] || []}
        dipendentiList={dipendenti}
      />
    </div>
  );
}
