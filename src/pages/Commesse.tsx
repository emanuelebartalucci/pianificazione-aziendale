import { useState, useEffect, useMemo, Fragment } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Briefcase, Printer, ChevronLeft, ChevronRight, Calendar, Download } from 'lucide-react';
import { getWeekNumber, getStartOfWeek, addDays } from '../utils/date';

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
  const { dipendenti, commesse } = useAuth();
  
  const [baseDate, setBaseDate] = useState<Date>(new Date());
  const [zoomWeeks, setZoomWeeks] = useState<number>(13); // Default to 3 Months (13 Weeks)
  const [selectedCommessaFilter, setSelectedCommessaFilter] = useState<string>(''); // Single commessa detail view
  const [assignments, setAssignments] = useState<Record<string, Assegnazione[]>>({});
  
  // Collapse state for clients
  const [collapsedClients, setCollapsedClients] = useState<Record<string, boolean>>({});

  const toggleClientCollapse = (clientName: string) => {
    setCollapsedClients(prev => ({ ...prev, [clientName]: !prev[clientName] }));
  };
  
  // Real-time listener for allocations
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
    if (selectedCommessaFilter) {
      const comm = commesse.find(c => c.id === selectedCommessaFilter);
      if (comm && comm.dataInizio && comm.dataFine) {
        const start = new Date(comm.dataInizio);
        const end = new Date(comm.dataFine);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const numWks = Math.max(1, Math.min(52, Math.ceil(diffDays / 7)));
        return generateWeeksExtended(start, numWks);
      }
    }
    // Standard zoom mode
    return generateWeeksExtended(baseDate, zoomWeeks);
  }, [baseDate, zoomWeeks, selectedCommessaFilter, commesse]);

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
    const list = selectedCommessaFilter 
      ? commesse.filter(c => c.id === selectedCommessaFilter)
      : commesse;

    const groups: Record<string, { clientName: string; commesseList: typeof commesse }> = {};
    
    list.forEach(c => {
      const code = parseClientCode(c.nome);
      const clientKey = code || 'vari';
      const clientName = code ? getClientName(code) : 'Altri Clienti';
      
      if (!groups[clientKey]) {
        groups[clientKey] = { clientName, commesseList: [] };
      }
      groups[clientKey].commesseList.push(c);
    });
    
    return Object.values(groups).sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [commesse, selectedCommessaFilter]);

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

  const shiftPeriod = (weeksOffset: number) => {
    setBaseDate(prev => addDays(prev, weeksOffset * 7));
  };
  
  const resetToToday = () => {
    setBaseDate(new Date());
  };

  return (
    <div className="flex flex-col gap-6">
      
      {/* HEADER */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm p-4 sm:p-6 border border-white/50 no-print flex flex-col md:flex-row justify-between items-center gap-4">
        <h2 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
          <div className="p-3 bg-blue-100 rounded-2xl"><Briefcase className="text-blue-600 w-8 h-8" /></div>
          <span>Pianificazione Avanzamento Commesse</span>
        </h2>
        
        <div className="flex items-center gap-2 text-xs font-bold bg-blue-50 text-blue-700 px-4 py-2 rounded-xl border border-blue-100">
          Vista di Sola Consultazione
        </div>
      </div>

      {/* TIMELINE TABLE CARD */}
      <div className="bg-white rounded-[2rem] shadow-xl border relative mb-10 flex flex-col max-h-[750px]">
        
        {/* TOOLBAR */}
        <div className="p-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4 no-print bg-gray-50/50 rounded-t-[2rem] shrink-0 md:h-20">
          <div className="flex flex-wrap items-center justify-between gap-4 w-full">
            
            {/* Filters and Zoom */}
            <div className="flex flex-wrap items-center gap-4 flex-1">
              
              {/* Zoom / Duration Selector */}
              {!selectedCommessaFilter && (
                <div className="flex flex-col">
                  <label className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider ml-1 mb-1">Periodo Zoom</label>
                  <select 
                    value={zoomWeeks}
                    onChange={e => setZoomWeeks(Number(e.target.value))}
                    className="p-2.5 border-none bg-white rounded-xl border shadow-sm font-bold text-gray-700 text-xs outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value={5}>1 Mese (5 Settimane)</option>
                    <option value={13}>3 Mesi (13 Settimane)</option>
                    <option value={26}>6 Mesi (26 Settimane)</option>
                  </select>
                </div>
              )}

              {/* Commessa Filter (Gantt detail) */}
              <div className="flex flex-col">
                <label className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider ml-1 mb-1">Dettaglio Commessa</label>
                <select 
                  value={selectedCommessaFilter}
                  onChange={e => {
                    setSelectedCommessaFilter(e.target.value);
                    resetToToday();
                  }}
                  className="p-2.5 border bg-white rounded-xl font-bold text-gray-700 text-xs outline-none focus:ring-2 focus:ring-blue-400 w-60"
                >
                  <option value="">-- Tutte le Commesse --</option>
                  {commesse.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.nome} {c.dataInizio && c.dataFine ? `(${c.dataInizio.substring(5)} - ${c.dataFine.substring(5)})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Show timeline info */}
              {selectedCommessaFilter && (
                <div className="flex flex-col justify-end h-full mt-5">
                  <div className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-2 rounded-xl flex items-center gap-1.5">
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
          <table className="w-full text-left border-collapse min-w-[1200px] text-xs">
            <thead className="sticky top-0 z-30 bg-white shadow-sm border-b-2 border-gray-200">
              {/* Month Group Header Row */}
              <tr className="bg-gray-50 border-b text-[11px] font-black text-gray-500 text-center uppercase tracking-wider">
                <th className="p-2.5 text-left w-72 sticky left-0 top-0 z-35 bg-gray-50 shadow-[1px_0_0_0_#e5e7eb] font-black">Mesi</th>
                {monthSpans.map((span, idx) => (
                  <th key={idx} colSpan={span.colSpan} className="p-2 border-l border-gray-200 text-center bg-gray-50/80 font-black sticky top-0 z-30">
                    {span.label}
                  </th>
                ))}
              </tr>
              {/* Week Header Row */}
              <tr>
                <th className="p-4 font-extrabold text-gray-900 w-72 sticky left-0 top-[36px] z-35 bg-white shadow-[1px_0_0_0_#e5e7eb]">
                  Commesse e Clienti
                </th>
                {activeWeeks.map((wk, i) => {
                  const isCurrentWeek = wk.id === `${new Date().getFullYear()}-W${getWeekNumber(new Date())}`;
                  return (
                    <th key={i} className={`p-3 text-center border-l border-b border-gray-200 min-w-[120px] sticky top-[36px] z-30 bg-white ${isCurrentWeek ? 'bg-blue-50/50 ring-2 ring-inset ring-blue-200' : ''}`}>
                      <div className="font-extrabold text-gray-900">{wk.label}</div>
                      <div className="text-[11px] font-bold text-gray-400 mt-0.5">{wk.sub}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            
            <tbody className="divide-y divide-gray-100 font-medium">
              {groupedCommesse.length === 0 ? (
                <tr>
                  <td colSpan={activeWeeks.length + 1} className="p-12 text-center text-gray-400 font-bold italic">
                    Nessuna commessa registrata a catalogo.
                  </td>
                </tr>
              ) : (
                groupedCommesse.map(group => {
                  const isCollapsed = collapsedClients[group.clientName] || false;
                  return (
                    <Fragment key={group.clientName}>
                      {/* CLIENT HEADER ROW */}
                      <tr 
                        onClick={() => toggleClientCollapse(group.clientName)}
                        className="bg-gray-50 font-black text-gray-800 text-xs cursor-pointer hover:bg-gray-100 transition-colors select-none"
                      >
                        <td colSpan={activeWeeks.length + 1} className="p-3.5 pl-6 text-left border-b border-gray-200 uppercase bg-gray-100 sticky left-0 top-[84px] z-20">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 text-[10px] w-3 text-center">{isCollapsed ? '▶' : '▼'}</span>
                            <span className="text-[13px] font-black">Cliente: {group.clientName}</span>
                            <span className="text-[11px] text-gray-450 font-bold ml-1">({group.commesseList.length} {group.commesseList.length === 1 ? 'commessa' : 'commesse'})</span>
                          </div>
                        </td>
                      </tr>
                      
                      {/* COMMESSE ROWS */}
                      {!isCollapsed && group.commesseList.map(comm => (
                        <tr key={comm.id} className="hover:bg-blue-50/20 transition-colors bg-white">
                          {/* Commessa title col */}
                          <td className="p-4 font-bold text-gray-800 bg-white sticky left-0 z-10 shadow-[1px_0_0_0_#f3f4f6] border-b align-middle w-72">
                            <div className="flex items-center gap-3">
                              <span className="w-3.5 h-3.5 rounded-full shadow-inner shrink-0" style={{backgroundColor: comm.colore}}></span>
                              <div className="min-w-0">
                                <div className="truncate font-extrabold text-sm text-gray-800" title={comm.nome}>{comm.nome}</div>
                                {comm.dataInizio && comm.dataFine && (
                                  <div className="text-[10px] text-gray-400 font-bold mt-0.5">
                                    Periodo: {formatDate(comm.dataInizio)} - {formatDate(comm.dataFine)}
                                  </div>
                                )}
                                {(comm.responsabile || comm.pm) && (
                                  <div className="text-[9.5px] text-gray-500 font-semibold mt-1">
                                    {comm.responsabile && `Resp: ${comm.responsabile}`} {comm.pm && ` | PM: ${comm.pm}`}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Weeks cols */}
                          {activeWeeks.map((wk, wIndex) => {
                            const assignedPeople = getAssignmentsForCommessaInWeek(comm.id, wk.id);
                            const isCurrentWeek = wk.id === `${new Date().getFullYear()}-W${getWeekNumber(new Date())}`;
                            return (
                              <td key={wIndex} className={`p-3 border-l border-b border-gray-100 align-top ${isCurrentWeek ? 'bg-blue-50/20' : 'bg-white/40'}`}>
                                <div className="min-h-[66px] flex flex-col gap-1.5">
                                  {assignedPeople.map((person, pIdx) => {
                                    const daysDesc = person.giorni ? ` (${person.giorni.length === 5 ? 'Sett' : person.giorni.join(',')})` : '';
                                    const leaves = getLeavesForResourceInWeek(person.name, wk.id);
                                    return (
                                      <div 
                                        key={pIdx} 
                                        className="text-[11px] bg-indigo-50/80 text-indigo-950 p-2 rounded-lg border border-indigo-100/60 flex flex-col shadow-sm gap-0.5"
                                        title={`${person.name} - Impegno: ${person.pct}%${daysDesc}${leaves.length > 0 ? `\nAssenze: ${leaves.map(l => `${l.giorno} (${l.dettagli})`).join(', ')}` : ''}`}
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
                      ))}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
