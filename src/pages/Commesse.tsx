import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, onSnapshot, query, where, doc, setDoc } from 'firebase/firestore';
import { Briefcase, Printer, ChevronLeft, ChevronRight, Calendar, Download, Pencil, X, ZoomIn, ZoomOut } from 'lucide-react';
import { getWeekNumber, getStartOfWeek, addDays } from '../utils/date';
import { queueMail } from '../utils/mailSender';
import { TIPOLOGIA_COLORS } from '../utils/commesseIniziali';

const isWeekWithinRange = (wkDateObj: Date | undefined, startStr?: string, endStr?: string): boolean => {
  if (!wkDateObj || !startStr || !endStr) return false;
  const start = new Date(startStr);
  const end = new Date(endStr);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  
  const wkStart = new Date(wkDateObj);
  wkStart.setHours(0, 0, 0, 0);
  
  const wkEnd = new Date(wkStart);
  wkEnd.setDate(wkStart.getDate() + 6);
  wkEnd.setHours(23, 59, 59, 999);
  
  return wkStart <= end && wkEnd >= start;
};

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

// Client dictionary for code translation
const CLIENTI_DICTIONARY: Record<string, string> = {
  '61': 'GSK',
  '12': 'Novartis',
  '33': 'Eli Lilly',
  '45': 'Pfizer',
  '01': 'Ingegnoso',
  '99': 'Cliente di Test'
};

const getClientName = (code: string): string => {
  return CLIENTI_DICTIONARY[code] || `Cliente ${code}`;
};

const parseClientCode = (commessaName: string): string => {
  const match = commessaName.match(/^P-\d+-(\d+)/i);
  if (match) {
    return match[1];
  }
  return '';
};

const formatDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
};

const areNamesEqual = (n1?: string | null, n2?: string | null): boolean => {
  if (!n1 || !n2) return false;
  const clean1 = n1.toLowerCase().trim().replace(/\s+/g, ' ');
  const clean2 = n2.toLowerCase().trim().replace(/\s+/g, ' ');
  if (clean1 === clean2) return true;
  const w1 = clean1.split(' ').sort().join(' ');
  const w2 = clean2.split(' ').sort().join(' ');
  return w1 === w2;
};

const getInitials = (name: string): string => {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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

export default function Commesse() {
  const { isAdmin, isSenior, myAssociatedName, dipendenti, commesse } = useAuth();
  
  const [baseDate, setBaseDate] = useState<Date>(new Date());
  const [zoomWeeks, setZoomWeeks] = useState<number>(13); // Default to 3 Months (13 Weeks)
  const [selectedCommessaFilter, setSelectedCommessaFilter] = useState<string>(''); // Single commessa detail view
  const [commessaTextQuery, setCommessaTextQuery] = useState('');
  const [assignments, setAssignments] = useState<Record<string, Assegnazione[]>>({});
  
  const weekColumnMinWidth = useMemo(() => {
    // Estimating remaining width of a container on standard screen (approx 900px)
    const containerWidth = 900;
    const calculated = Math.floor(containerWidth / zoomWeeks);
    return `${Math.max(35, Math.min(150, calculated))}px`;
  }, [zoomWeeks]);

  const isNarrow = useMemo(() => parseInt(weekColumnMinWidth) < 80, [weekColumnMinWidth]);
  const isUltraNarrow = useMemo(() => parseInt(weekColumnMinWidth) < 50, [weekColumnMinWidth]);

  const [collapsedClients, setCollapsedClients] = useState<Record<string, boolean>>({});

  const toggleClientCollapse = (clientName: string) => {
    setCollapsedClients(prev => ({
      ...prev,
      [clientName]: !prev[clientName]
    }));
  };
  
  // Stati per la modifica dei dettagli della commessa (Responsabile, PM, Date)
  const [editingCommessa, setEditingCommessa] = useState<any | null>(null);
  const [editResponsabile, setEditResponsabile] = useState('');
  const [editPM, setEditPM] = useState('');
  const [editDataInizio, setEditDataInizio] = useState('');
  const [editDataFine, setEditDataFine] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  
  const [seniorsEmails, setSeniorsEmails] = useState<string[]>([]);
  const [pmsEmails, setPmsEmails] = useState<string[]>([]);
  const [isCommessaDropdownOpen, setIsCommessaDropdownOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  const handleSelectCommessaFilter = (commId: string) => {
    setSelectedCommessaFilter(commId);
    if (commId) {
      const comm = commesse.find(c => c.id === commId);
      if (comm && comm.dataInizio && comm.dataFine) {
        const start = new Date(comm.dataInizio);
        const end = new Date(comm.dataFine);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const numWks = Math.max(2, Math.min(52, Math.ceil(diffDays / 7)));
        
        setBaseDate(getStartOfWeek(start));
        setZoomWeeks(numWks);
      }
    } else {
      setBaseDate(new Date());
      setZoomWeeks(13); // Reset to default 3 months
    }
  };
  
  // Real-time listener for allocations and roles
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'assegnazioni'), (snapshot) => {
      const ass: Record<string, Assegnazione[]> = {};
      snapshot.forEach(docSnap => {
        ass[docSnap.id] = docSnap.data().lista || [];
      });
      setAssignments(ass);
    });

    const unsubS = onSnapshot(collection(db, 'seniors'), (snapshot) => {
      setSeniorsEmails(snapshot.docs.map(d => (d.data().email || '').toLowerCase()));
    });

    const unsubP = onSnapshot(collection(db, 'project_managers'), (snapshot) => {
      setPmsEmails(snapshot.docs.map(d => (d.data().email || '').toLowerCase()));
    });

    return () => { unsub(); unsubS(); unsubP(); };
  }, []);

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

  // Dynamically determine baseDate and number of weeks if a single commessa is selected
  const activeWeeks = useMemo(() => {
    return generateWeeksExtended(baseDate, zoomWeeks);
  }, [baseDate, zoomWeeks]);

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
    groupedCommesse.forEach(group => {
      group.commesseList.forEach(comm => {
        const row = [
          group.clientName,
          comm.nome,
          comm.responsabile || "",
          comm.pm || "",
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

  // Group commesse by client
  const groupedCommesse = useMemo(() => {
    // Filter commesse if a single one is selected in detail
    let list = selectedCommessaFilter 
      ? commesse.filter(c => c.id === selectedCommessaFilter)
      : commesse;

    if (commessaTextQuery.trim()) {
      const query = commessaTextQuery.toLowerCase().trim();
      list = list.filter(c => {
        const name = (c.nome || '').toLowerCase();
        const code = ((c as any).codiceCommessa || '').toLowerCase();
        const titolo = ((c as any).titolo || '').toLowerCase();
        const cliente = ((c as any).cliente || '').toLowerCase();
        const resp = (c.responsabile || '').toLowerCase();
        const pm = (c.pm || '').toLowerCase();
        return name.includes(query) ||
               code.includes(query) ||
               titolo.includes(query) ||
               cliente.includes(query) ||
               resp.includes(query) ||
               pm.includes(query);
      });
    }

    // Filter for standard employees
    if (!isAdmin && !isSenior && myAssociatedName) {
      const assignedCommessaIds = new Set<string>();
      Object.entries(assignments).forEach(([key, listAss]) => {
        if (key.startsWith(`${myAssociatedName}-`)) {
          listAss.forEach(ass => {
            if (ass.percentuale > 0) {
              assignedCommessaIds.add(ass.commessaId);
            }
          });
        }
      });

      list = list.filter(c => 
        assignedCommessaIds.has(c.id) ||
        areNamesEqual(c.responsabile, myAssociatedName) ||
        areNamesEqual(c.pm, myAssociatedName)
      );
    }

    const groups: Record<string, { clientName: string; commesseList: typeof commesse }> = {};
    
    list.forEach(c => {
      const clientName = c.cliente ? c.cliente.trim() : (parseClientCode(c.nome) ? getClientName(parseClientCode(c.nome)) : 'Altri Clienti');
      const clientKey = clientName.toUpperCase() || 'ALTRI CLIENTI';
      
      if (!groups[clientKey]) {
        groups[clientKey] = { clientName, commesseList: [] };
      }
      groups[clientKey].commesseList.push(c);
    });
    
    return Object.values(groups).sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [commesse, selectedCommessaFilter, commessaTextQuery, isAdmin, isSenior, myAssociatedName, assignments]);

  // Get people allocated to a commessa in a specific week
  const getAssignmentsForCommessaInWeek = (commId: string, wkId: string) => {
    const list: { name: string; pct: number; giorni?: string[] }[] = [];
    dipendenti.forEach(d => {
      const key = `${d.nome}-${wkId}`;
      const assList = assignments[key] || [];
      const match = assList.find(a => a.commessaId === commId);
      if (match) {
        list.push({ name: d.nome, pct: match.percentuale, giorni: match.giorni });
      }
    });
    return list;
  };

  const handleOpenEditModal = (comm: any) => {
    setEditingCommessa(comm);
    
    // Find matching employee in dipendenti to use their official database name formatting
    const respDip = dipendenti.find(d => areNamesEqual(d.nome, comm.responsabile));
    setEditResponsabile(respDip ? respDip.nome : (comm.responsabile || ''));
    
    const pmDip = dipendenti.find(d => areNamesEqual(d.nome, comm.pm));
    setEditPM(pmDip ? pmDip.nome : (comm.pm || ''));
    
    setEditDataInizio(comm.dataInizio || '');
    setEditDataFine(comm.dataFine || '');
  };

  const handleSaveCommessaDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCommessa) return;

    if (editDataInizio && editDataFine && editDataInizio > editDataFine) {
      showToast("La data di inizio non può essere successiva alla data di fine.", "error");
      return;
    }

    setSavingEdit(true);
    try {
      const docRef = doc(db, 'catalogo_commesse', editingCommessa.id);
      const updates = {
        responsabile: editResponsabile,
        pm: editPM,
        dataInizio: editDataInizio,
        dataFine: editDataFine
      };

      await setDoc(docRef, updates, { merge: true });

      // Invia notifiche email se sono state fatte assegnazioni
      if (editResponsabile && editResponsabile !== editingCommessa.responsabile) {
        const respDip = dipendenti.find(d => d.nome === editResponsabile);
        if (respDip && respDip.email) {
          const subject = `[Notifica] Abilitazione Funzioni Responsabile - Commessa ${editingCommessa.nome}`;
          const htmlBody = `
            <p>Ciao <strong>${editResponsabile}</strong>,</p>
            <p>Sei stato assegnato come <strong>Responsabile</strong> per la commessa <strong>${editingCommessa.nome}</strong>.</p>
            ${editDataInizio ? `<p>Periodo previsto: dal <strong>${formatDate(editDataInizio)}</strong> al <strong>${formatDate(editDataFine)}</strong>.</p>` : ''}
            <p>Puoi procedere all'assegnazione e pianificazione delle risorse per questa commessa direttamente dall'applicazione.</p>
          `;
          const plainText = `Ciao ${editResponsabile},\n\nSei stato assegnato come Responsabile per la commessa ${editingCommessa.nome}.\n\nPuoi procedere alla pianificazione dall'applicazione.\n\nQuesta è una notifica automatica.`;
          await queueMail(respDip.email.toLowerCase(), subject, htmlBody, plainText);
        }
      }

      if (editPM && editPM !== editingCommessa.pm && editPM !== editResponsabile) {
        const pmDip = dipendenti.find(d => d.nome === editPM);
        if (pmDip && pmDip.email) {
          const subject = `[Notifica] Abilitazione Funzioni PM - Commessa ${editingCommessa.nome}`;
          const htmlBody = `
            <p>Ciao <strong>${editPM}</strong>,</p>
            <p>Sei stato assegnato come <strong>Project Manager (PM)</strong> per la commessa <strong>${editingCommessa.nome}</strong>.</p>
            ${editDataInizio ? `<p>Periodo previsto: dal <strong>${formatDate(editDataInizio)}</strong> al <strong>${formatDate(editDataFine)}</strong>.</p>` : ''}
            <p>Puoi procedere al monitoraggio e pianificazione delle risorse per questa commessa dall'applicazione.</p>
          `;
          const plainText = `Ciao ${editPM},\n\nSei stato assegnato come Project Manager (PM) per la commessa ${editingCommessa.nome}.\n\nPuoi procedere alla pianificazione dall'applicazione.\n\nQuesta è una notifica automatica.`;
          await queueMail(pmDip.email.toLowerCase(), subject, htmlBody, plainText);
        }
      }

      setEditingCommessa(null);
      showToast("Dettagli commessa salvati con successo!", "success");
    } catch (err) {
      console.error("Errore salvataggio dettagli commessa:", err);
      showToast("Si è verificato un errore durante il salvataggio.", "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const shiftPeriod = (weeksOffset: number) => {
    setBaseDate(prev => addDays(prev, weeksOffset * 7));
  };
  
  const resetToToday = () => {
    setBaseDate(new Date());
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
          <span>Pianificazione Avanzamento Commesse</span>
        </h2>
        
        <div className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl border ${
          (isAdmin || isSenior) ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-blue-50 text-blue-700 border-blue-100'
        }`}>
          {(isAdmin || isSenior) ? 'Vista Amministrazione e Assegnazione' : 'Vista di Sola Consultazione'}
        </div>
      </div>

      {/* TIMELINE TABLE CARD */}
      <div className="bg-white rounded-[2rem] shadow-xl border relative mb-10 flex flex-col max-h-[750px]">
        
        {/* TOOLBAR */}
        <div className="p-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4 no-print bg-gray-50/50 rounded-t-[2rem] shrink-0 md:h-20">
          <div className="flex flex-wrap items-center justify-between gap-4 w-full">
            
            {/* Filters and Zoom */}
            <div className="flex flex-wrap items-center gap-4 flex-1">
              
              {/* Zoom Temporale magnifier buttons */}
              <div className="flex flex-col">
                <label className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider ml-1 mb-1">Zoom Temporale</label>
                <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-gray-200 shadow-sm h-[38px]">
                  <button 
                    type="button"
                    onClick={() => setZoomWeeks(prev => Math.max(2, prev - 2))} 
                    className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-650 transition flex items-center justify-center cursor-pointer"
                    title="Zoom In (Vedi meno settimane, più dettaglio)"
                  >
                    <ZoomIn className="w-4 h-4 text-blue-600" />
                  </button>
                  <span className="text-xs font-bold text-gray-750 min-w-[50px] text-center select-none">{zoomWeeks} Sett.</span>
                  <button 
                    type="button"
                    onClick={() => setZoomWeeks(prev => Math.min(52, prev + 2))} 
                    className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-650 transition flex items-center justify-center cursor-pointer"
                    title="Zoom Out (Vedi più settimane, panoramica)"
                  >
                    <ZoomOut className="w-4 h-4 text-blue-600" />
                  </button>
                </div>
              </div>

              {/* Combined Searchable Commessa Dropdown */}
              <div className="relative flex flex-col">
                <label className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider ml-1 mb-1">Cerca Commessa</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsCommessaDropdownOpen(!isCommessaDropdownOpen)}
                    className="p-2.5 border bg-white rounded-xl font-bold text-gray-700 text-xs text-left outline-none focus:ring-2 focus:ring-blue-400 w-80 shadow-sm flex justify-between items-center cursor-pointer"
                  >
                    <span className="truncate mr-4 text-gray-700">
                      {selectedCommessaFilter 
                        ? (commesse.find(c => c.id === selectedCommessaFilter)?.nome || 'Commessa selezionata') 
                        : 'Tutte le Commesse'}
                    </span>
                    <span className="text-gray-400 ml-auto shrink-0 text-[10px]">▼</span>
                  </button>
                  {selectedCommessaFilter && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectCommessaFilter('');
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
                    <div className="absolute left-0 mt-12 w-96 max-h-80 bg-white border border-gray-150 rounded-2xl shadow-2xl z-50 p-3 flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
                      <div className="relative shrink-0">
                        <input
                          type="text"
                          placeholder="Cerca per codice, titolo, cliente..."
                          value={commessaTextQuery}
                          onChange={e => setCommessaTextQuery(e.target.value)}
                          className="w-full p-2.5 pl-3 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50/50 text-gray-700"
                          autoFocus
                        />
                        {commessaTextQuery && (
                          <button
                            type="button"
                            onClick={() => setCommessaTextQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-black"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <div className="overflow-y-auto max-h-56 divide-y divide-gray-50 pr-1 scrollbar-thin">
                        <button
                          type="button"
                          onClick={() => {
                            handleSelectCommessaFilter('');
                            setCommessaTextQuery('');
                            setIsCommessaDropdownOpen(false);
                          }}
                          className="w-full text-left p-2.5 hover:bg-blue-50 text-xs font-bold text-blue-600 transition-colors cursor-pointer rounded-lg"
                        >
                          -- Mostra Tutte le Commesse --
                        </button>
                        {(() => {
                          const search = commessaTextQuery.toLowerCase().trim();
                          let allowedCommesse = commesse;
                          
                          if (!isAdmin && !isSenior && myAssociatedName) {
                            const assignedCommessaIds = new Set<string>();
                            Object.entries(assignments).forEach(([key, listAss]) => {
                              if (key.startsWith(`${myAssociatedName}-`)) {
                                listAss.forEach(ass => {
                                  if (ass.percentuale > 0) {
                                    assignedCommessaIds.add(ass.commessaId);
                                  }
                                });
                              }
                            });
                            allowedCommesse = commesse.filter(c => 
                              assignedCommessaIds.has(c.id) ||
                              areNamesEqual(c.responsabile, myAssociatedName) ||
                              areNamesEqual(c.pm, myAssociatedName)
                            );
                          }

                          const filtered = allowedCommesse.filter(c => {
                            const name = (c.nome || '').toLowerCase();
                            const code = (c.codiceCommessa || '').toLowerCase();
                            const client = (c.cliente || '').toLowerCase();
                            const resp = (c.responsabile || '').toLowerCase();
                            const pm = (c.pm || '').toLowerCase();
                            const tipologia = (c.tipologia || '').toLowerCase();
                            const anno = (c.anno || '').toLowerCase();
                            return name.includes(search) ||
                                   code.includes(search) ||
                                   client.includes(search) ||
                                   resp.includes(search) ||
                                   pm.includes(search) ||
                                   tipologia.includes(search) ||
                                   anno.includes(search);
                          });

                          if (filtered.length === 0) {
                            return <div className="p-3 text-xs text-gray-400 italic font-bold">Nessuna commessa trovata</div>;
                          }

                          return filtered.map(c => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                handleSelectCommessaFilter(c.id);
                                setCommessaTextQuery('');
                                setIsCommessaDropdownOpen(false);
                              }}
                              className="w-full text-left p-2.5 hover:bg-blue-50 text-xs font-semibold text-gray-700 transition-colors flex flex-col gap-0.5 cursor-pointer rounded-lg"
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{backgroundColor: TIPOLOGIA_COLORS[c.tipologia || ''] || c.colore || '#64748b'}}></span>
                                <span className="font-bold text-gray-800 truncate">{c.nome}</span>
                              </div>
                              {c.cliente && (
                                <span className="text-[10px] text-gray-400 font-bold ml-4">Cliente: {c.cliente}</span>
                              )}
                            </button>
                          ));
                        })()}
                      </div>
                    </div>
                  </>
                )}
              </div>
              
              {/* Show timeline info */}
              {selectedCommessaFilter && (
                <div className="flex flex-col justify-end h-[38px]">
                  <div className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-2 rounded-xl flex items-center gap-1.5 h-full">
                    <Calendar className="w-3.5 h-3.5" />
                    Mostrato intero arco temporale della commessa.
                  </div>
                </div>
              )}
            </div>

            {/* Navigation Controls */}
            {!selectedCommessaFilter && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm">
                  <button onClick={() => shiftPeriod(-zoomWeeks)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600 transition" title="Indietro"><ChevronLeft className="w-4 h-4" /></button>
                  <button onClick={resetToToday} className="px-3 py-1.5 text-xs font-extrabold text-gray-700 hover:bg-gray-100 rounded-lg transition">Oggi</button>
                  <button onClick={() => shiftPeriod(zoomWeeks)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600 transition" title="Avanti"><ChevronRight className="w-4 h-4" /></button>
                  <div className="h-5 w-px bg-gray-200 mx-1"></div>
                  <input 
                    type="date" 
                    value={baseDate.toISOString().split('T')[0]} 
                    onChange={e => setBaseDate(new Date(e.target.value))} 
                    className="text-xs font-bold border-none bg-transparent outline-none text-gray-700 cursor-pointer pl-1 pr-1" 
                  />
                </div>
                
                <button onClick={handleExportToExcel} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition shadow-md active:scale-95">
                  <Download className="w-4 h-4" /> Esporta Excel
                </button>

                <button onClick={() => window.print()} className="flex items-center gap-2 bg-gray-900 text-white hover:bg-gray-800 px-4 py-2.5 rounded-xl text-sm font-bold transition shadow-md active:scale-95">
                  <Printer className="w-4 h-4" /> Stampa
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Load Grid Wrapper */}
        <div className="w-full overflow-auto scrollbar-thin flex-1">
          <table className="w-full text-left border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-30 bg-white shadow-sm border-b-2 border-gray-200">
              {/* Month Group Header Row */}
              <tr className="bg-gray-50 border-b text-[11px] font-black text-gray-500 text-center uppercase tracking-wider" style={{ height: '40px' }}>
                <th 
                  className="p-0 pl-2.5 text-left sticky left-0 top-0 z-35 bg-gray-50 shadow-[1px_0_0_0_#e5e7eb] font-black truncate"
                  style={{ width: '180px', minWidth: '180px', maxWidth: '180px', height: '40px', lineHeight: '40px' }}
                >
                  Mesi
                </th>
                {monthSpans.map((span, idx) => (
                  <th key={idx} colSpan={span.colSpan} className="p-0 border-l border-gray-200 text-center bg-gray-50 font-black sticky top-0 z-30" style={{ height: '40px', lineHeight: '40px' }}>
                    {span.label}
                  </th>
                ))}
              </tr>
              {/* Week Header Row */}
              <tr className="h-12">
                <th 
                  className="p-4 font-extrabold text-gray-900 sticky left-0 z-35 bg-white shadow-[1px_0_0_0_#e5e7eb] h-12 truncate"
                  style={{ width: '180px', minWidth: '180px', maxWidth: '180px', top: '39px' }}
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
                      {!isNarrow && (
                        <div className="text-[10px] font-bold text-gray-400 mt-0.5 truncate">{wk.sub}</div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            
            {groupedCommesse.length === 0 ? (
              <tbody className="divide-y divide-gray-100 font-medium">
                <tr>
                  <td colSpan={activeWeeks.length + 1} className="p-12 text-center text-gray-400 font-bold italic">
                    {!isAdmin && !isSenior ? "Non sei assegnato a nessuna commessa in questo periodo." : "Nessuna commessa registrata a catalogo."}
                  </td>
                </tr>
              </tbody>
            ) : (
              groupedCommesse.map(group => {
                return (
                  <tbody key={group.clientName} className="divide-y divide-gray-105 font-medium">
                    {/* CLIENT HEADER ROW */}
                    {group.clientName && group.clientName.toUpperCase() !== 'ALTRI CLIENTI' && group.clientName.toUpperCase() !== 'VARI' && (
                      <tr 
                        onClick={() => toggleClientCollapse(group.clientName)}
                        className="bg-gray-50 font-black text-gray-800 text-xs select-none cursor-pointer hover:bg-gray-100 transition-colors"
                      >
                        <td colSpan={activeWeeks.length + 1} className="p-3.5 pl-6 text-left border-b border-gray-200 uppercase bg-gray-100 sticky left-0 z-20" style={{ top: '87px' }}>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500 w-3 text-center">{collapsedClients[group.clientName] ? '▶' : '▼'}</span>
                            <span className="text-[13px] font-black">Cliente: {group.clientName}</span>
                            <span className="text-[11px] text-gray-450 font-bold ml-1">({group.commesseList.length} {group.commesseList.length === 1 ? 'commessa' : 'commesse'})</span>
                          </div>
                        </td>
                      </tr>
                    )}
                    {group.commesseList.map(comm => {
                      if (collapsedClients[group.clientName]) return null;
                      return (
                        <tr key={comm.id} className="hover:bg-blue-50/20 transition-colors bg-white">
                        <td 
                          className="p-4 font-bold text-gray-800 bg-white sticky left-0 z-10 shadow-[1px_0_0_0_#f3f4f6] border-b align-middle text-left truncate"
                          style={{ width: '180px', minWidth: '180px', maxWidth: '180px' }}
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-3.5 h-3.5 rounded-full shadow-inner shrink-0" style={{backgroundColor: (comm.tipologia && TIPOLOGIA_COLORS[comm.tipologia]) || comm.colore || '#64748b'}}></span>
                            <div className="min-w-0 flex-1 text-left">
                              <div className="flex items-center gap-1.5 justify-between">
                                <div className="truncate font-extrabold text-sm text-gray-800" title={comm.nome}>{comm.nome}</div>
                                {(isAdmin || isSenior) && (
                                  <button 
                                    onClick={() => handleOpenEditModal(comm)}
                                    className="text-gray-400 hover:text-blue-600 p-1 rounded transition-colors shrink-0 cursor-pointer"
                                    title="Modifica dettagli (Responsabile, PM, Date)"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                              {comm.dataInizio && comm.dataFine ? (
                                <div className="text-[10px] text-gray-400 font-bold mt-0.5 truncate" title={`${formatDate(comm.dataInizio)} - ${formatDate(comm.dataFine)}`}>
                                  Periodo: {formatDate(comm.dataInizio)} - {formatDate(comm.dataFine)}
                                </div>
                              ) : (
                                <div className="text-[10px] text-orange-500 font-bold mt-0.5 truncate">
                                  Nessun periodo impostato
                                </div>
                              )}
                              {(comm.responsabile || comm.pm) ? (
                                <div className="text-[9.5px] text-gray-500 font-semibold mt-1 truncate" title={`${comm.responsabile ? `Resp: ${comm.responsabile}` : ''}${comm.pm ? ` | PM: ${comm.pm}` : ''}`}>
                                  {comm.responsabile && `Resp: ${comm.responsabile}`} {comm.pm && ` | PM: ${comm.pm}`}
                                </div>
                              ) : (
                                <div className="text-[9.5px] text-gray-450 font-medium mt-1 italic truncate">
                                  Resp/PM non assegnati
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        {activeWeeks.map((wk, wIndex) => {
                          const assignedPeople = getAssignmentsForCommessaInWeek(comm.id, wk.id);
                          const isCurrentWeek = wk.id === `${new Date().getFullYear()}-W${getWeekNumber(new Date())}`;
                          const isWithinRange = isWeekWithinRange(wk.dateObj, comm.dataInizio, comm.dataFine);
                          const commColor = (comm.tipologia && TIPOLOGIA_COLORS[comm.tipologia]) || comm.colore || '#3b82f6';
                          const cellBg = isWithinRange ? hexToRgba(commColor, 0.08) : undefined;
                          return (
                            <td 
                              key={wIndex} 
                              className={`${isUltraNarrow ? 'p-1' : isNarrow ? 'p-1.5' : 'p-3'} border-l border-b border-gray-100 align-top ${isCurrentWeek ? 'ring-2 ring-inset ring-blue-300' : ''}`}
                              style={{ backgroundColor: cellBg, minWidth: weekColumnMinWidth, width: weekColumnMinWidth }}
                            >
                              <div 
                                className="flex flex-col"
                                style={{ 
                                  minHeight: isNarrow ? '40px' : '66px', 
                                  gap: isUltraNarrow ? '2px' : isNarrow ? '4px' : '6px' 
                                }}
                              >
                                {assignedPeople.map((person, pIdx) => {
                                  const daysDesc = person.giorni ? ` (${person.giorni.length === 5 ? 'Sett' : person.giorni.join(',')})` : '';
                                  const leaves = getLeavesForResourceInWeek(person.name, wk.id);
                                  const hasLeaves = leaves.length > 0;
                                  const tooltipText = `${person.name} - Impegno: ${person.pct}%${daysDesc}${hasLeaves ? `\nAssenze: ${leaves.map(l => `${l.giorno} (${l.dettagli})`).join(', ')}` : ''}`;

                                  if (isUltraNarrow) {
                                    return (
                                      <div 
                                        key={pIdx} 
                                        className={`text-[9px] font-black text-center py-1 px-0.5 rounded-md border flex items-center justify-center shadow-sm select-none ${
                                          hasLeaves 
                                            ? 'bg-rose-50 text-rose-800 border-rose-200 ring-1 ring-rose-300' 
                                            : 'bg-indigo-50 text-indigo-900 border-indigo-150'
                                        }`}
                                        title={tooltipText}
                                      >
                                        {person.pct}%
                                      </div>
                                    );
                                  }

                                  if (isNarrow) {
                                    const initials = getInitials(person.name);
                                    return (
                                      <div 
                                        key={pIdx} 
                                        className={`text-[10px] font-bold text-center py-1 px-1 rounded-md border flex items-center justify-center gap-0.5 shadow-sm truncate select-none ${
                                          hasLeaves 
                                            ? 'bg-rose-50 text-rose-800 border-rose-200' 
                                            : 'bg-indigo-50 text-indigo-900 border-indigo-150'
                                        }`}
                                        title={tooltipText}
                                      >
                                        <span className="truncate">{initials}</span>
                                        <span className="font-extrabold text-[9px] text-indigo-600 shrink-0">{person.pct}%</span>
                                        {hasLeaves && <span className="text-[8px] text-red-500 shrink-0">⚠️</span>}
                                      </div>
                                    );
                                  }

                                  return (
                                    <div 
                                      key={pIdx} 
                                      className="text-[11px] bg-indigo-50/80 text-indigo-950 p-2 rounded-lg border border-indigo-100/60 flex flex-col shadow-sm gap-0.5"
                                      title={tooltipText}
                                    >
                                      <div className="flex justify-between items-center font-bold">
                                        <span className="truncate pr-1">{person.name}</span>
                                        <span className="text-indigo-600 font-black">{person.pct}%</span>
                                      </div>
                                      {person.giorni && person.giorni.length > 0 && person.giorni.length < 5 && (
                                        <span className="text-[9.5px] text-indigo-500 font-black tracking-tight">{person.giorni.join(',')}</span>
                                      )}
                                      {leaves.length > 0 && (
                                        <div className="mt-1 pt-1 border-t border-red-100 text-[9.5px] text-red-600 font-bold flex flex-col gap-0.5">
                                          {leaves.map((l, lIdx) => (
                                            <span key={lIdx} className="flex items-center gap-0.5 truncate" title={`${l.giorno}: ${l.dettagli}`}>
                                              ⚠️ {l.giorno}: {l.tipo === 'ferie' ? 'F' : l.tipo === 'malattia' ? 'M' : l.tipo === 'permesso' ? 'P' : 'A'}
                                            </span>
                                          ))}
                                        </div>
                                      )}
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
                );
              })
            )}
          </table>
        </div>
      </div>

      {editingCommessa && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-md w-full border border-gray-150 p-6 flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <Briefcase className="w-6 h-6 text-blue-600" />
                <span>Assegna Resp/PM & Date</span>
              </h3>
              <button onClick={() => setEditingCommessa(null)} className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl">
              <div className="text-[11px] font-bold uppercase tracking-wider text-blue-500">Commessa in modifica</div>
              <div className="font-extrabold text-blue-900 text-sm mt-0.5">{editingCommessa.nome}</div>
            </div>

            <form onSubmit={handleSaveCommessaDetails} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">Responsabile</label>
                <select 
                  value={editResponsabile} 
                  onChange={e => setEditResponsabile(e.target.value)}
                  className="w-full p-3 border-none bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 shadow-inner font-bold text-gray-700"
                >
                  <option value="">-- Nessuno --</option>
                  {(() => {
                    const list = dipendenti.filter(d => d.email && seniorsEmails.includes(d.email.toLowerCase()));
                    if (editResponsabile && !list.some(d => d.nome === editResponsabile)) {
                      const current = dipendenti.find(d => d.nome === editResponsabile);
                      if (current) list.push(current);
                    }
                    return list.map(d => <option key={d.id} value={d.nome}>{d.nome}</option>);
                  })()}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">Project Manager (PM)</label>
                <select 
                  value={editPM} 
                  onChange={e => setEditPM(e.target.value)}
                  className="w-full p-3 border-none bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 shadow-inner font-bold text-gray-700"
                >
                  <option value="">-- Nessuno --</option>
                  {(() => {
                    const list = dipendenti.filter(d => d.email && pmsEmails.includes(d.email.toLowerCase()));
                    if (editPM && !list.some(d => d.nome === editPM)) {
                      const current = dipendenti.find(d => d.nome === editPM);
                      if (current) list.push(current);
                    }
                    return list.map(d => <option key={d.id} value={d.nome}>{d.nome}</option>);
                  })()}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">Data Inizio (Opzionale)</label>
                  <input 
                    type="date" 
                    value={editDataInizio} 
                    onChange={e => setEditDataInizio(e.target.value)}
                    className="w-full p-3 border-none bg-gray-50 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 shadow-inner font-semibold text-gray-650"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">Data Fine (Opzionale)</label>
                  <input 
                    type="date" 
                    value={editDataFine} 
                    onChange={e => setEditDataFine(e.target.value)}
                    className="w-full p-3 border-none bg-gray-50 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 shadow-inner font-semibold text-gray-650"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button" 
                  onClick={() => setEditingCommessa(null)} 
                  className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-xs font-bold text-gray-650 hover:bg-gray-50 transition"
                >
                  Annulla
                </button>
                <button 
                  type="submit" 
                  disabled={savingEdit}
                  className="flex-1 py-3 px-4 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition active:scale-95 disabled:opacity-50"
                >
                  {savingEdit ? 'Salvataggio...' : 'Salva Modifiche'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
