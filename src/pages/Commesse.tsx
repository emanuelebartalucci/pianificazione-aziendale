import { useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, doc, setDoc, addDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { Briefcase, ChevronLeft, ChevronRight, Calendar, Download, Pencil, X, ZoomIn, ZoomOut, Trash2, RefreshCw } from 'lucide-react';
import { getWeekNumber, getStartOfWeek, addDays } from '../utils/date';
import { queueMail } from '../utils/mailSender';
import { TIPOLOGIA_COLORS } from '../utils/commesseIniziali';
import ConfirmModal from '../components/ConfirmModal';
import { TIPOLOGIE_COMMESSE } from './Impostazioni';

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
  const { 
    isAdmin, 
    isSenior, 
    myAssociatedName, 
    dipendenti, 
    commesse, 
    clienti: clientiList, 
    assegnazioni: assignments, 
    approvedLeaves, 
    coordinatori, 
    pmsEmails, 
    seniorsEmails 
  } = useAuth();
  
  const [baseDate, setBaseDate] = useState<Date>(new Date());
  const [zoomWeeks, setZoomWeeks] = useState<number>(10); // Default to 10 Weeks
  const [selectedCommessaIdsFilter, setSelectedCommessaIdsFilter] = useState<string[]>([]);
  const [selectedClientFilter, setSelectedClientFilter] = useState<string>('');
  const [selectedPMFilter, setSelectedPMFilter] = useState<string>('');
  const [selectedTipologiaFilter, setSelectedTipologiaFilter] = useState<string>('');
  const [commessaTextQuery, setCommessaTextQuery] = useState('');

  // Tab control
  const [activeTab, setActiveTab] = useState<'consultazione' | 'gestione'>('consultazione');

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
  const [newCommessaSeniorDays, setNewCommessaSeniorDays] = useState('');
  const [newCommessaProjectDays, setNewCommessaProjectDays] = useState('');
  const [newCommessaJuniorDays, setNewCommessaJuniorDays] = useState('');

  // Searchable Client Dropdown States
  const [selectedClient, setSelectedClient] = useState<{ codice: string; nome: string } | null>(null);
  const [clientSearchText, setClientSearchText] = useState('');
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);

  // Search filter for catalogo
  const [searchCommessaQuery, setSearchCommessaQuery] = useState('');
  
  const weekColumnMinWidth = useMemo(() => {
    // Estimating remaining width of a container on standard screen (approx 900px)
    const containerWidth = 900;
    const calculated = Math.floor(containerWidth / zoomWeeks);
    return `${Math.max(35, Math.min(150, calculated))}px`;
  }, [zoomWeeks]);

  const isNarrow = useMemo(() => parseInt(weekColumnMinWidth) < 80, [weekColumnMinWidth]);
  const isUltraNarrow = useMemo(() => parseInt(weekColumnMinWidth) < 50, [weekColumnMinWidth]);


  
  const selectableClientiPerFiltro = useMemo(() => {
    const set = new Set<string>();
    commesse.forEach(c => {
      if (c.cliente) set.add(c.cliente.trim());
    });
    return Array.from(set).sort();
  }, [commesse]);

  const selectablePMPerFiltro = useMemo(() => {
    const set = new Set<string>();
    commesse.forEach(c => {
      if (c.responsabile) set.add(c.responsabile.trim());
    });
    return Array.from(set).sort();
  }, [commesse]);

  const selectableTipologiePerFiltro = useMemo(() => {
    const set = new Set<string>();
    commesse.forEach(c => {
      if (c.tipologia) set.add(c.tipologia.trim());
    });
    return Array.from(set).sort();
  }, [commesse]);

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

  // Stati per la modifica dei dettagli della commessa (Responsabile, PM, Date)
  const [editingCommessa, setEditingCommessa] = useState<any | null>(null);
  const [editResponsabile, setEditResponsabile] = useState('');
  const [editPMs, setEditPMs] = useState<string[]>([]);
  const [selectedAddPM, setSelectedAddPM] = useState('');
  const [editSeniorDays, setEditSeniorDays] = useState('');
  const [editProjectDays, setEditProjectDays] = useState('');
  const [editJuniorDays, setEditJuniorDays] = useState('');
  const [editDataInizio, setEditDataInizio] = useState('');
  const [editDataFine, setEditDataFine] = useState('');
  const [editStato, setEditStato] = useState('Aperta');
  const [savingEdit, setSavingEdit] = useState(false);
  
  const [isCommessaDropdownOpen, setIsCommessaDropdownOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
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

  // Filtra commesse con filtri avanzati ed in ordine alfabetico
  const filteredCommesse = useMemo(() => {
    let list = commesse;

    // Filtro per multi-selezione commesse
    if (selectedCommessaIdsFilter.length > 0) {
      list = list.filter(c => selectedCommessaIdsFilter.includes(c.id));
    }

    // Filtro per Cliente
    if (selectedClientFilter) {
      list = list.filter(c => c.cliente === selectedClientFilter);
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

    // Filtro per standard employees (che vedono solo quelle a cui sono assegnati)
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

      list = list.filter(c => {
        const pmArray = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
        const isPM = pmArray.some(name => areNamesEqual(name, myAssociatedName));
        return assignedCommessaIds.has(c.id) ||
               areNamesEqual(c.responsabile, myAssociatedName) ||
               isPM;
      });
    }

    // Ordine alfabetico
    return [...list].sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  }, [commesse, selectedCommessaIdsFilter, selectedClientFilter, selectedPMFilter, selectedTipologiaFilter, commessaTextQuery, isAdmin, isSenior, myAssociatedName, assignments]);

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
    
    // Gestione PMs multipli: comm.pm può essere un array o una stringa
    let initialPMs: string[] = [];
    if (comm.pm) {
      if (Array.isArray(comm.pm)) {
        initialPMs = comm.pm;
      } else {
        initialPMs = [comm.pm];
      }
    }
    const formattedPMs = initialPMs.map(pmName => {
      const pmDip = dipendenti.find(d => areNamesEqual(d.nome, pmName));
      return pmDip ? pmDip.nome : pmName;
    });
    setEditPMs(formattedPMs);
    setSelectedAddPM('');

    // Giornate stimate
    setEditSeniorDays(comm.giornateSeniorProject !== undefined ? String(comm.giornateSeniorProject) : '0');
    setEditProjectDays(comm.giornateProject !== undefined ? String(comm.giornateProject) : '0');
    setEditJuniorDays(comm.giornateJuniorProject !== undefined ? String(comm.giornateJuniorProject) : '0');
    
    setEditDataInizio(comm.dataInizio || '');
    setEditDataFine(comm.dataFine || '');
    setEditStato(comm.stato || 'Aperta');
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
        pm: editPMs,
        giornateSeniorProject: Number(editSeniorDays) || 0,
        giornateProject: Number(editProjectDays) || 0,
        giornateJuniorProject: Number(editJuniorDays) || 0,
        dataInizio: editDataInizio,
        dataFine: editDataFine,
        stato: editStato
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

      // Notifica ai PM aggiunti
      const oldPMs = Array.isArray(editingCommessa.pm) 
        ? editingCommessa.pm 
        : (editingCommessa.pm ? [editingCommessa.pm] : []);
      const addedPMs = editPMs.filter(p => !oldPMs.includes(p));

      for (const addedPM of addedPMs) {
        const pmDip = dipendenti.find(d => d.nome === addedPM);
        if (pmDip && pmDip.email) {
          const subject = `[Notifica] Abilitazione Funzioni PM - Commessa ${editingCommessa.nome}`;
          const htmlBody = `
            <p>Ciao <strong>${addedPM}</strong>,</p>
            <p>Sei stato assegnato come <strong>Project Manager (PM)</strong> per la commessa <strong>${editingCommessa.nome}</strong>.</p>
            ${editDataInizio ? `<p>Periodo previsto: dal <strong>${formatDate(editDataInizio)}</strong> al <strong>${formatDate(editDataFine)}</strong>.</p>` : ''}
            <p>Puoi procedere al monitoraggio e pianificazione delle risorse per questa commessa dall'applicazione.</p>
          `;
          const plainText = `Ciao ${addedPM},\n\nSei stato assegnato come Project Manager (PM) per la commessa ${editingCommessa.nome}.\n\nPuoi procedere alla pianificazione dall'applicazione.\n\nQuesta è una notifica automatica.`;
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

  const getParsedField = (c: any, field: 'anno' | 'tipologia') => {
    if (c[field]) return c[field];
    if (!c.codiceCommessa) return '';
    const match = c.codiceCommessa.match(/^([A-Za-z]+)(\d{2})/);
    if (!match) return '';
    if (field === 'anno') return `20${match[2]}`;
    return match[1].toUpperCase();
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

  const responsabiliMacroAreeList = useMemo(() => {
    const coordEmails = new Set(coordinatori.map(c => c.email.toLowerCase()));
    return dipendenti.filter(d => d.email && coordEmails.has(d.email.toLowerCase()));
  }, [dipendenti, coordinatori]);


  const pmsList = useMemo(() => {
    return dipendenti.filter(d => d.email && pmsEmails.includes(d.email.toLowerCase()));
  }, [dipendenti, pmsEmails]);

  const isResponsabileDiQualcheCommessa = useMemo(() => {
    return commesse.some(c => {
      const pmArray = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
      const isPM = pmArray.some(name => areNamesEqual(name, myAssociatedName));
      return areNamesEqual(c.responsabile, myAssociatedName) || isPM;
    });
  }, [commesse, myAssociatedName]);

  const commesseGestibili = useMemo(() => {
    if (isAdmin || isSenior) return commesse;
    return commesse.filter(c => {
      const pmArray = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
      const isPM = pmArray.some(name => areNamesEqual(name, myAssociatedName));
      return areNamesEqual(c.responsabile, myAssociatedName) || isPM;
    });
  }, [commesse, isAdmin, isSenior, myAssociatedName]);

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
        dataInizio: newCommessaDataInizio || '',
        dataFine: newCommessaDataFine || '',
        responsabile: newCommessaResponsabile || '',
        pm: [],
        giornateSeniorProject: Number(newCommessaSeniorDays) || 0,
        giornateProject: Number(newCommessaProjectDays) || 0,
        giornateJuniorProject: Number(newCommessaJuniorDays) || 0
      };
      
      await addDoc(collection(db, 'catalogo_commesse'), payload);
      
      setSelectedClient(null);
      setClientSearchText('');
      setNewCommessaTitolo('');
      setNewCommessaDataInizio('');
      setNewCommessaDataFine('');
      setNewCommessaLettera('A');
      setNewCommessaResponsabile('');
      setNewCommessaSeniorDays('');
      setNewCommessaProjectDays('');
      setNewCommessaJuniorDays('');
      
      showToast("Commessa salvata nel catalogo con successo!", "success");
    } catch (err) {
      console.error("Errore salvataggio commessa:", err);
      showToast("Si è verificato un errore durante il salvataggio.", "error");
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
          
          // 2. Elimina a cascata le assegnazioni
          const querySnapshot = await getDocs(collection(db, 'assegnazioni'));
          for (const docSnap of querySnapshot.docs) {
            const data = docSnap.data();
            const currentList = data.lista || [];
            const updatedList = currentList.filter((a: any) => a.commessaId !== id);
            
            if (currentList.length !== updatedList.length) {
              if (updatedList.length === 0) {
                await deleteDoc(doc(db, 'assegnazioni', docSnap.id));
              } else {
                await setDoc(doc(db, 'assegnazioni', docSnap.id), { lista: updatedList });
              }
            }
          }

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
          </div>
        </h2>
        
        <div className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl border ${
          (isAdmin || isSenior || isResponsabileDiQualcheCommessa) ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-blue-50 text-blue-700 border-blue-100'
        }`}>
          {(isAdmin || isSenior || isResponsabileDiQualcheCommessa) ? 'Vista Amministrazione e Assegnazione' : 'Vista di Sola Consultazione'}
        </div>
      </div>
      
      {/* TAB BAR (Solo per Admin, Seniors e Responsabili) */}
      {(isAdmin || isSenior || isResponsabileDiQualcheCommessa) && (
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
        </div>
      )}

      {/* TAB 1: CONSULTAZIONE COMMESSE */}
      {(activeTab === 'consultazione' || (!isAdmin && !isSenior)) && (
        <>
          {/* TIMELINE TABLE CARD */}
          <div className="bg-white rounded-[2rem] shadow-xl border relative mb-10 flex flex-col max-h-[750px] pb-4">
            
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

                  {/* Filtro Tipologia */}
                  <div className="flex flex-col">
                    <label className="text-[10px] font-extrabold text-gray-455 uppercase tracking-wider ml-1 mb-1">Tipo</label>
                    <select
                      value={selectedTipologiaFilter}
                      onChange={e => setSelectedTipologiaFilter(e.target.value)}
                      className="p-2 border bg-white rounded-xl font-bold text-gray-700 text-xs outline-none focus:ring-2 focus:ring-blue-400 w-32 shadow-sm cursor-pointer h-[38px]"
                    >
                      <option value="">Tutte le Tipologie</option>
                      {selectableTipologiePerFiltro.map(t => (
                        <option key={t} value={t}>{t}</option>
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
                                const filteredComms = commesse.filter(c => {
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
                              
                              let listToDisplay = commesse;
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
                                listToDisplay = commesse.filter(c => {
                                  const pmArray = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
                                  const isPM = pmArray.some(name => areNamesEqual(name, myAssociatedName));
                                  return assignedCommessaIds.has(c.id) ||
                                         areNamesEqual(c.responsabile, myAssociatedName) ||
                                         isPM;
                                });
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
                  {(selectedClientFilter || selectedPMFilter || selectedTipologiaFilter || selectedCommessaIdsFilter.length > 0) && (
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
                {selectedCommessaIdsFilter.length !== 1 && (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm">
                      <button onClick={() => shiftPeriod(-zoomWeeks)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-655 transition" title="Indietro"><ChevronLeft className="w-4 h-4" /></button>
                      <button onClick={resetToToday} className="px-3 py-1.5 text-xs font-extrabold text-gray-700 hover:bg-gray-100 rounded-lg transition">Oggi</button>
                      <button onClick={() => shiftPeriod(zoomWeeks)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-655 transition" title="Avanti"><ChevronRight className="w-4 h-4" /></button>
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
                  </div>
                )}
              </div>
            </div>
{/* Load Grid Wrapper with clipping for rounded corners */}
            <div className="w-full flex-1 overflow-hidden rounded-b-2xl flex flex-col">
              <div className="w-full overflow-auto scrollbar-thin flex-1">
                <table className="w-full text-left border-separate border-spacing-0 text-xs">
                <thead className="sticky top-0 z-30 bg-white shadow-sm border-b-2 border-gray-200">
                  {/* Month Group Header Row */}
                  <tr className="bg-gray-50 border-b text-[11px] font-black text-gray-500 text-center uppercase tracking-wider" style={{ height: '40px' }}>
                    <th 
                      className="p-0 pl-2.5 text-left sticky left-0 top-0 z-35 bg-gray-50 shadow-[1px_0_0_0_#e5e7eb] font-black truncate"
                      style={{ width: '240px', minWidth: '240px', maxWidth: '240px', height: '40px', lineHeight: '40px' }}
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
                      style={{ width: '240px', minWidth: '240px', maxWidth: '240px', top: '39px' }}
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
                        {!isAdmin && !isSenior ? "Non sei assegnato a nessuna commessa in questo periodo." : "Nessuna commessa trovata con i filtri selezionati."}
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
                            style={{ width: '240px', minWidth: '240px', maxWidth: '240px' }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-full shadow-inner shrink-0" style={{backgroundColor: (comm.tipologia && TIPOLOGIA_COLORS[comm.tipologia]) || comm.colore || '#64748b'}}></span>
                              <div className="min-w-0 flex-1 text-left">
                                <div className="flex items-center gap-1.5 justify-between">
                                  <div className="whitespace-normal break-words font-extrabold text-xs text-gray-800" title={comm.nome}>{comm.nome}</div>
                                  {(() => {
                                    const pmArray = Array.isArray(comm.pm) ? comm.pm : (comm.pm ? [comm.pm] : []);
                                    const isPM = pmArray.some(name => areNamesEqual(name, myAssociatedName));
                                    const isResp = areNamesEqual(comm.responsabile, myAssociatedName);
                                    const canEdit = isAdmin || isSenior || isPM || isResp;
                                    
                                    return canEdit && (
                                      <button 
                                        onClick={() => handleOpenEditModal(comm)}
                                        className="text-gray-400 hover:text-blue-600 p-1 rounded transition-colors shrink-0 cursor-pointer"
                                        title="Modifica dettagli (Responsabile, PM, Date)"
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </button>
                                    );
                                  })()}
                                </div>
                                <div className="text-[9.5px] text-indigo-655 font-bold italic mt-0.5">
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
                                  <div className="text-[9px] text-gray-500 font-semibold mt-1 truncate" title={`${comm.responsabile ? `Resp: ${comm.responsabile}` : ''}${comm.pm ? ` | PM: ${comm.pm}` : ''}`}>
                                    {comm.responsabile && `Resp: ${comm.responsabile}`} {comm.pm && ` | PM: ${comm.pm}`}
                                  </div>
                                ) : (
                                  <div className="text-[9px] text-gray-455 font-medium mt-1 italic truncate">
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
                                className={`${isUltraNarrow ? 'p-1' : 'p-2'} border-l border-b border-gray-100 align-top ${isCurrentWeek ? 'ring-2 ring-inset ring-blue-300' : ''}`}
                                style={{ backgroundColor: cellBg, minWidth: weekColumnMinWidth, width: weekColumnMinWidth }}
                              >
                                <div 
                                  className="flex flex-col"
                                  style={{ 
                                    minHeight: isNarrow ? '30px' : '40px', 
                                    gap: '4px' 
                                  }}
                                >
                                  {assignedPeople.map((person, pIdx) => {
                                    const hours = Math.round(person.pct * 40 / 100);
                                    const leaves = getLeavesForResourceInWeek(person.name, wk.id);
                                    const hasLeaves = leaves.length > 0;
                                    const leavesStr = leaves.map(l => `${l.giorno}: ${l.tipo === 'ferie' ? 'Ferie' : l.tipo === 'malattia' ? 'Malattia' : l.tipo === 'permesso' ? 'Permesso' : 'Assenza'}${l.dettagli ? ` (${l.dettagli})` : ''}`).join(', ');
                                    const tooltipText = `${person.name} - Impegno: ${person.pct}% (${hours}h)${hasLeaves ? `\nAssenze: ${leavesStr}` : ''}`;

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
                                          className={`text-[10px] font-bold py-1 px-1.5 rounded-md border flex items-center justify-between gap-1 shadow-sm truncate select-none w-full ${
                                            hasLeaves 
                                              ? 'bg-rose-50 text-rose-800 border-rose-200' 
                                              : 'bg-indigo-50 text-indigo-900 border-indigo-150'
                                          }`}
                                          title={tooltipText}
                                        >
                                          <span className="truncate text-left">{initials}</span>
                                          <span className="font-extrabold text-[9px] text-indigo-655 shrink-0 text-right">{person.pct}% ({hours}h)</span>
                                          {hasLeaves && <span className="text-[8px] text-red-500 shrink-0 ml-0.5">⚠️</span>}
                                        </div>
                                      );
                                    }

                                    return (
                                      <div 
                                        key={pIdx} 
                                        className="text-[11px] bg-indigo-50/80 text-indigo-950 p-1.5 rounded-lg border border-indigo-100/60 flex items-center justify-between gap-1 shadow-sm w-full select-none"
                                        title={tooltipText}
                                      >
                                        <div className="flex items-center gap-1 min-w-0 flex-1">
                                          {hasLeaves && <span className="text-[11px] shrink-0 text-amber-500" title={`Assenze: ${leavesStr}`}>⚠️</span>}
                                          <span className="truncate font-bold text-left">{person.name}</span>
                                        </div>
                                        <span className="text-indigo-650 font-black shrink-0 text-right text-[10px]">{person.pct}% ({hours}h)</span>
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
          </div>
        </div>

        </>
      )}

      {/* TAB 2: GESTIONE CATALOGO (Per Admin, Seniors e Responsabili) */}
      {(activeTab === 'gestione' && (isAdmin || isSenior || isResponsabileDiQualcheCommessa)) && (
        <div className="space-y-8">
          <section className="bg-gradient-to-br from-emerald-50 to-teal-50 p-6 rounded-3xl border border-emerald-100 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-emerald-900 flex items-center gap-2">
                <Briefcase className="w-6 h-6 text-emerald-600" /> Catalogo Commesse
              </h3>
            </div>
            
            {(isAdmin || isSenior) && (
              <div className="mb-6 bg-white/50 p-5 rounded-2xl border border-emerald-100/50 shadow-inner">
                <form onSubmit={handleAddCommessa} className="space-y-4">
                
                {/* Selettore Cliente Ricercabile */}
                <div className="relative">
                  <label className="block text-[10px] font-bold text-emerald-950 mb-1 ml-1">Cliente (Cerca e Seleziona)</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Digita per cercare un cliente per codice o ragione sociale..."
                      value={selectedClient ? selectedClient.nome : clientSearchText}
                      onChange={e => {
                        setClientSearchText(e.target.value);
                        if (selectedClient) setSelectedClient(null);
                        setIsClientDropdownOpen(true);
                      }}
                      onFocus={() => setIsClientDropdownOpen(true)}
                      className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs"
                    />
                    {selectedClient && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedClient(null);
                          setClientSearchText('');
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-red-500 hover:text-red-700 font-extrabold text-[10px] bg-red-50 px-2 py-1 rounded-lg transition"
                      >
                        Rimuovi
                      </button>
                    )}
                  </div>
                  {isClientDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setIsClientDropdownOpen(false)}></div>
                      <div className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto bg-white border border-gray-150 rounded-xl shadow-xl divide-y divide-gray-50">
                        {(() => {
                          const search = clientSearchText.toLowerCase();
                          const filtered = clientiList.filter(c =>
                            c.nome.toLowerCase().includes(search) || c.codice.includes(search)
                          );
                          if (filtered.length === 0) {
                            return <div className="p-3 text-xs text-gray-450 italic font-bold">Nessun cliente trovato</div>;
                          }
                          return filtered.map(c => (
                            <button
                              key={c.codice}
                              type="button"
                              onClick={() => {
                                setSelectedClient(c);
                                setClientSearchText(c.nome);
                                setIsClientDropdownOpen(false);
                              }}
                              className="w-full text-left p-3 hover:bg-emerald-50 text-xs font-semibold text-gray-700 transition-colors flex justify-between items-center cursor-pointer"
                            >
                              <span>{c.nome}</span>
                              <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-black">Cod. {c.codice}</span>
                            </button>
                          ));
                        })()}
                      </div>
                    </>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-950 mb-1 ml-1">Tipologia</label>
                    <select value={newCommessaTipologia} onChange={e => setNewCommessaTipologia(e.target.value)} className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs">
                      {Object.entries(TIPOLOGIE_COMMESSE).map(([code, desc]) => (
                        <option key={code} value={code}>{code} - {desc}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-950 mb-1 ml-1">Anno</label>
                    <input required type="text" maxLength={4} placeholder="Es. 2026" value={newCommessaAnno} onChange={e => setNewCommessaAnno(e.target.value)} className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs text-center" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-950 mb-1 ml-1">Progressivo</label>
                    <input required type="text" maxLength={2} placeholder="Es. A" value={newCommessaLettera} onChange={e => setNewCommessaLettera(e.target.value.toUpperCase())} className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs text-center" />
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
                    <label className="block text-[10px] font-bold text-emerald-950 mb-1 ml-1">Responsabile (Selezionato tra i Coordinatori)</label>
                    <select value={newCommessaResponsabile} onChange={e => setNewCommessaResponsabile(e.target.value)} className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700 text-xs">
                      <option value="">-- Nessuno --</option>
                      {responsabiliMacroAreeList.map(r => (
                        <option key={r.id} value={r.nome}>{r.nome}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Sezione Giornate Stimate */}
                <div className="bg-emerald-100/30 p-4 rounded-2xl border border-emerald-100/50 space-y-3">
                  <h4 className="text-xs font-black text-emerald-950 uppercase tracking-wide">Giornate Stimate di Lavoro</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[9px] font-bold text-emerald-900 mb-1 ml-1">Senior Project</label>
                      <input type="number" min={0} placeholder="0" value={newCommessaSeniorDays} onChange={e => setNewCommessaSeniorDays(e.target.value)} className="w-full p-2 border-none rounded-lg bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-750 text-xs text-center" />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-emerald-900 mb-1 ml-1">Project</label>
                      <input type="number" min={0} placeholder="0" value={newCommessaProjectDays} onChange={e => setNewCommessaProjectDays(e.target.value)} className="w-full p-2 border-none rounded-lg bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-750 text-xs text-center" />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-emerald-900 mb-1 ml-1">Junior Project</label>
                      <input type="number" min={0} placeholder="0" value={newCommessaJuniorDays} onChange={e => setNewCommessaJuniorDays(e.target.value)} className="w-full p-2 border-none rounded-lg bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-750 text-xs text-center" />
                    </div>
                  </div>
                </div>

                <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl transition font-bold shadow-md active:scale-95 text-sm flex items-center justify-center gap-1.5 mt-2 cursor-pointer">
                  Salva Commessa nel Catalogo
                </button>
              </form>
            </div>
          )}

            {/* Box di ricerca commesse */}
            <div className="mb-3">
              <input 
                type="text" 
                placeholder="Cerca commessa per codice, titolo, cliente o responsabile..." 
                value={searchCommessaQuery} 
                onChange={e => setSearchCommessaQuery(e.target.value)} 
                className="w-full p-3 border-none rounded-xl bg-white focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 transition shadow-inner font-semibold text-xs text-gray-700" 
              />
            </div>

            <div className="max-h-[450px] overflow-auto bg-white/50 rounded-xl border border-emerald-100">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-emerald-100 text-emerald-900 font-extrabold shadow-sm z-10">
                  <tr>
                    <th className="p-2.5">Codice</th>
                    <th className="p-2.5">Anno</th>
                    <th className="p-2.5">Tip.</th>
                    <th className="p-2.5">Titolo</th>
                    <th className="p-2.5">Cliente</th>
                    <th className="p-2.5">Stato</th>
                    <th className="p-2.5">Resp.</th>
                    <th className="p-2.5">PM</th>
                    <th className="p-2.5">Giornate Stimate (S/P/J)</th>
                    <th className="p-2.5 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-50/60 font-medium text-emerald-950">
                  {(() => {
                    const filtered = commesseGestibili.filter(c => {
                      const queryStr = searchCommessaQuery.toLowerCase();
                      const codice = (c as any).codiceCommessa || '';
                      const titolo = (c as any).titolo || c.nome || '';
                      const cliente = (c as any).cliente || '';
                      const resp = c.responsabile || '';
                      const pmArray = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
                      const pmStr = pmArray.join(', ');
                      return codice.toLowerCase().includes(queryStr) ||
                             titolo.toLowerCase().includes(queryStr) ||
                             cliente.toLowerCase().includes(queryStr) ||
                             resp.toLowerCase().includes(queryStr) ||
                             pmStr.toLowerCase().includes(queryStr) ||
                             c.nome.toLowerCase().includes(queryStr);
                    });

                    if (filtered.length === 0) {
                      return (
                        <tr>
                          <td colSpan={9} className="p-8 text-center text-gray-400 font-bold italic">
                            Nessuna commessa trovata.
                          </td>
                        </tr>
                      );
                    }

                    return filtered.map(c => {
                      const computedTipologia = getParsedField(c, 'tipologia');
                      const computedAnno = getParsedField(c, 'anno');
                      const computedColor = TIPOLOGIA_COLORS[computedTipologia] || c.colore || '#64748b';

                      return (
                        <tr key={c.id} className="hover:bg-emerald-50/50 transition-colors">
                          <td className="p-2.5 font-bold whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-inner" style={{backgroundColor: computedColor}}></span>
                              {(c as any).codiceCommessa || c.nome.split(' - ')[0]}
                            </div>
                          </td>
                          <td className="p-2.5">{computedAnno}</td>
                          <td className="p-2.5">{computedTipologia}</td>
                          <td className="p-2.5 max-w-[200px] truncate" title={(c as any).titolo || c.nome}>{(c as any).titolo || c.nome}</td>
                          <td className="p-2.5 max-w-[150px] truncate" title={(c as any).cliente || ''}>{(c as any).cliente || ''}</td>
                          <td className="p-2.5 text-center">
                            <span className={`px-2 py-0.5 rounded-full font-black text-[9px] uppercase tracking-wider ${
                              (c as any).stato === 'Aperta' || !c.hasOwnProperty('stato') ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-650'
                            }`}>
                              {(c as any).stato || 'Aperta'}
                            </span>
                          </td>
                          <td className="p-2.5 truncate max-w-[100px]" title={c.responsabile || ''}>{c.responsabile || ''}</td>
                          <td className="p-2.5 truncate max-w-[120px]" title={(() => { const arr = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []); return arr.join(', '); })()}>{(() => { const arr = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []); return arr.join(', '); })() || ''}</td>
                          <td className="p-2.5 whitespace-nowrap font-bold text-slate-700">
                            {c.giornateSeniorProject !== undefined || c.giornateProject !== undefined || c.giornateJuniorProject !== undefined
                              ? `${c.giornateSeniorProject || 0} / ${c.giornateProject || 0} / ${c.giornateJuniorProject || 0}`
                              : '0 / 0 / 0'}
                          </td>
                          <td className="p-2.5 text-center">
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
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

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

              {/* Gestione PMs Multipli */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">Project Managers (PM)</label>
                
                {/* Lista PM attuali */}
                <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                  {editPMs.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">Nessun PM assegnato.</p>
                  ) : (
                    editPMs.map(pmName => (
                      <div key={pmName} className="p-2 bg-blue-50/50 rounded-xl border border-blue-100 flex justify-between items-center text-xs">
                        <span className="font-extrabold text-blue-950 truncate">{pmName}</span>
                        <button 
                          type="button" 
                          onClick={() => setEditPMs(prev => prev.filter(x => x !== pmName))}
                          className="text-red-400 hover:text-red-650 transition-colors p-1 cursor-pointer shrink-0"
                          title="Rimuovi PM"
                        >
                          <X className="w-3.5 h-3.5"/>
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Selettore aggiunta PM */}
                <div className="flex gap-2 mt-2">
                  <select 
                    value={selectedAddPM}
                    onChange={e => setSelectedAddPM(e.target.value)}
                    className="flex-1 p-2 bg-gray-50 border-none rounded-xl text-xs outline-none focus:ring-1 focus:ring-blue-500 shadow-inner font-bold text-gray-700"
                  >
                    <option value="">-- Seleziona PM da aggiungere --</option>
                    {pmsList.filter(p => !editPMs.includes(p.nome)).map(p => (
                      <option key={p.id} value={p.nome}>{p.nome}</option>
                    ))}
                  </select>
                  <button 
                    type="button"
                    onClick={() => {
                      if (selectedAddPM && !editPMs.includes(selectedAddPM)) {
                        setEditPMs(prev => [...prev, selectedAddPM]);
                        setSelectedAddPM('');
                      }
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-xl text-xs font-bold transition shadow-sm active:scale-95 cursor-pointer shrink-0"
                  >
                    Aggiungi
                  </button>
                </div>
              </div>

              {/* Sezione Giornate Stimate */}
              <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 space-y-3">
                <h4 className="text-xs font-black text-gray-900 uppercase tracking-wide">Giornate Stimate di Lavoro</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[9px] font-bold text-gray-700 mb-1 ml-1 text-center">Senior Project</label>
                    <input type="number" min={0} value={editSeniorDays} onChange={e => setEditSeniorDays(e.target.value)} className="w-full p-2 border-none rounded-lg bg-white shadow-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-750 text-xs text-center" />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-gray-700 mb-1 ml-1 text-center">Project</label>
                    <input type="number" min={0} value={editProjectDays} onChange={e => setEditProjectDays(e.target.value)} className="w-full p-2 border-none rounded-lg bg-white shadow-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-750 text-xs text-center" />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-gray-700 mb-1 ml-1 text-center">Junior Project</label>
                    <input type="number" min={0} value={editJuniorDays} onChange={e => setEditJuniorDays(e.target.value)} className="w-full p-2 border-none rounded-lg bg-white shadow-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-750 text-xs text-center" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">Stato</label>
                  <select 
                    value={editStato} 
                    onChange={e => setEditStato(e.target.value)}
                    className="w-full p-3 border-none bg-gray-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 shadow-inner font-bold text-gray-700"
                  >
                    <option value="Aperta">Aperta</option>
                    <option value="Chiusa">Chiusa</option>
                  </select>
                </div>
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
