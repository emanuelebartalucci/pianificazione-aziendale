import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { Briefcase, Printer, ChevronLeft, ChevronRight, PieChart, Search, Filter, LayoutGrid, LayoutList } from 'lucide-react';
import { generateWeeks, type WeekInfo, addDays, getWeekNumber, getStartOfWeek } from '../utils/date';
import AssegnazioneModal from '../components/AssegnazioneModal';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js';
import { Pie, Bar } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

interface Assegnazione {
  commessaId: string;
  commessaName: string;
  percentuale: number;
  colore: string;
  giorni?: string[];
}

export default function Commesse() {
  const { isAdmin, isSenior, dipendenti, commesse, myAssociatedName } = useAuth();
  
  const [baseDate, setBaseDate] = useState<Date>(new Date());
  const [weeks, setWeeks] = useState<WeekInfo[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Assegnazione[]>>({});
  const [viewRange, setViewRange] = useState<'settimana' | 'mese'>('mese');
  
  // UI States
  const [activeTab, setActiveTab] = useState<'tabella' | 'grafici'>('tabella');
  const [isCompact, setIsCompact] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCommessa, setFilterCommessa] = useState('');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalData, setModalData] = useState({ dipendente: '', weekId: '', weekLabel: '', weekSub: '', currentAssignments: [] as Assegnazione[] });

  // Chart state
  const [chartType, setChartType] = useState<'dipendente' | 'commessa'>('dipendente');
  const [chartTarget, setChartTarget] = useState<string>('');
  
  // Chart Date Range
  const [chartStartDate, setChartStartDate] = useState<string>('');
  const [chartEndDate, setChartEndDate] = useState<string>('');
  const [chartWeeks, setChartWeeks] = useState<WeekInfo[]>([]);

  useEffect(() => {
    const allWeeks = generateWeeks(baseDate);
    if (viewRange === 'settimana') {
      setWeeks([allWeeks[0]]);
    } else {
      setWeeks(allWeeks);
    }
  }, [baseDate, viewRange]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'assegnazioni'), (snapshot) => {
      const ass: Record<string, Assegnazione[]> = {};
      snapshot.forEach(doc => {
        ass[doc.id] = doc.data().lista || [];
      });
      setAssignments(ass);
    });
    return () => unsub();
  }, []);

  const daysOfWeek = useMemo(() => {
    const start = getStartOfWeek(baseDate);
    return [
      { label: 'Lunedì', key: 'Lun', date: start },
      { label: 'Martedì', key: 'Mar', date: addDays(start, 1) },
      { label: 'Mercoledì', key: 'Mer', date: addDays(start, 2) },
      { label: 'Giovedì', key: 'Gio', date: addDays(start, 3) },
      { label: 'Venerdì', key: 'Ven', date: addDays(start, 4) },
    ];
  }, [baseDate]);

  // Filtered Employees
  const dipendentiDaMostrare = useMemo(() => {
    let list = dipendenti;
    if (!isAdmin && !isSenior) {
      if (myAssociatedName) {
        list = dipendenti.filter(d => d.nome === myAssociatedName);
      } else {
        list = [{ id: 'wait', nome: "Profilo in attesa di configurazione", email: '' }];
      }
    }

    if (searchQuery) {
      list = list.filter(d => d.nome.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    if (filterCommessa) {
      list = list.filter(d => {
        // Controlla se il dipendente ha questa commessa in almeno una delle settimane visualizzate
        return weeks.some(wk => {
          const key = `${d.nome}-${wk.id}`;
          const assList = assignments[key] || [];
          return assList.some(a => a.commessaId === filterCommessa);
        });
      });
    }

    return list;
  }, [dipendenti, isAdmin, isSenior, myAssociatedName, searchQuery, filterCommessa, weeks, assignments]);

  // Default Chart targets
  useEffect(() => {
    if (chartType === 'dipendente' && dipendenti.length > 0 && !chartTarget) {
      setChartTarget(myAssociatedName || dipendenti[0].nome);
    } else if (chartType === 'commessa' && commesse.length > 0 && (!chartTarget || !commesse.find(c => c.id === chartTarget))) {
      setChartTarget(commesse[0].id);
    }
  }, [chartType, dipendenti, commesse, myAssociatedName, chartTarget]);

  // Calcolo delle settimane per il grafico
  useEffect(() => {
    if (!chartStartDate || !chartEndDate) {
      setChartWeeks(weeks); // Fallback
      return;
    }
    
    let current = new Date(chartStartDate);
    const end = new Date(chartEndDate);
    const generatedWeeks: WeekInfo[] = [];
    
    while (current <= end && generatedWeeks.length < 52) { // Max 1 anno di dati
      const wNum = getWeekNumber(current);
      const start = getStartOfWeek(current);
      const endWk = addDays(start, 4);
      generatedWeeks.push({
        id: `${current.getFullYear()}-W${wNum}`,
        label: `Settimana ${wNum}`,
        sub: `${start.getDate()}/${start.getMonth()+1} - ${endWk.getDate()}/${endWk.getMonth()+1}`,
        dateObj: current
      });
      current = addDays(current, 7);
    }
    setChartWeeks(generatedWeeks.length ? generatedWeeks : weeks);
  }, [chartStartDate, chartEndDate, weeks]);

  // Setta le date di default per i grafici
  useEffect(() => {
    if (!chartStartDate && weeks.length > 0) {
      setChartStartDate(weeks[0].dateObj?.toISOString().split('T')[0] || '');
      setChartEndDate(weeks[weeks.length - 1].dateObj?.toISOString().split('T')[0] || '');
    }
  }, [weeks, chartStartDate]);

  const shiftWeek = (days: number) => setBaseDate(prev => addDays(prev, days));
  const resetToToday = () => setBaseDate(new Date());

  const handleCellClick = (dipNome: string, weekId: string, weekLabel: string, weekSub: string) => {
    if (!isAdmin && !isSenior) return;
    if (dipNome === "Profilo in attesa di configurazione") return;
    
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

  const getChartData = () => {
    if (chartType === 'dipendente') {
      const dipNome = chartTarget;
      const dataMap: Record<string, { value: number, color: string }> = {};
      
      chartWeeks.forEach(wk => {
        const key = `${dipNome}-${wk.id}`;
        const assList = assignments[key] || [];
        assList.forEach(a => {
          if (!dataMap[a.commessaName]) dataMap[a.commessaName] = { value: 0, color: a.colore };
          dataMap[a.commessaName].value += Number(a.percentuale);
        });
      });

      const labels = Object.keys(dataMap);
      const data = labels.map(l => dataMap[l].value);
      const bgColors = labels.map(l => dataMap[l].color);

      return {
        labels: labels.length ? labels : ['Nessuna assegnazione'],
        datasets: [{
          data: data.length ? data : [1],
          backgroundColor: bgColors.length ? bgColors : ['#e5e7eb'],
          borderWidth: 1,
        }]
      };
    } else {
      const commId = chartTarget;
      const comm = commesse.find(c => c.id === commId);
      const commName = comm ? comm.nome : commId;
      const dataMap: Record<string, number> = {};

      dipendenti.forEach(d => {
        let total = 0;
        chartWeeks.forEach(wk => {
          const key = `${d.nome}-${wk.id}`;
          const assList = assignments[key] || [];
          assList.forEach(a => {
            if (a.commessaId === commId) total += Number(a.percentuale);
          });
        });
        if (total > 0) dataMap[d.nome] = total;
      });

      return {
        labels: Object.keys(dataMap),
        datasets: [{
          label: `Impegno totale su ${commName} (%)`,
          data: Object.values(dataMap),
          backgroundColor: comm?.colore || '#3b82f6',
        }]
      };
    }
  };

  return (
    <div className="flex flex-col gap-6">
      
      {/* HEADER E TABS */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm p-4 sm:p-6 border border-white/50 no-print flex flex-col md:flex-row justify-between items-center gap-4">
        <h2 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
          <div className="p-3 bg-blue-100 rounded-2xl"><Briefcase className="text-blue-600 w-8 h-8" /></div>
          <span id="commesse-title">{(isAdmin || isSenior) ? "Pianificazione Commesse" : "La tua Pianificazione Commesse"}</span>
        </h2>

        {(isAdmin || isSenior) && (
          <div className="flex bg-gray-100/80 p-1.5 rounded-2xl shadow-inner">
            <button 
              onClick={() => setActiveTab('tabella')}
              className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${activeTab === 'tabella' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <LayoutList className="w-4 h-4" /> Tabella
            </button>
            <button 
              onClick={() => setActiveTab('grafici')}
              className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${activeTab === 'grafici' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <PieChart className="w-4 h-4" /> Grafici
            </button>
          </div>
        )}
      </div>

      {/* CONTENUTO TABELLA */}
      {activeTab === 'tabella' && (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl border border-white/50 flex flex-col mb-10">
          
          {/* TOOLBAR TABELLA */}
          <div className="p-6 border-b border-gray-100 flex flex-col gap-4 bg-gray-50/50 rounded-t-[2rem]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* Filtri */}
              <div className="flex flex-wrap items-center gap-3 flex-1 no-print">
                {(isAdmin || isSenior) && (
                  <>
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input 
                        type="text" 
                        placeholder="Cerca dipendente..." 
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="pl-9 pr-4 py-2 border-none bg-white rounded-xl shadow-inner text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-400 outline-none w-48"
                      />
                    </div>
                    <div className="relative">
                      <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <select 
                        value={filterCommessa}
                        onChange={e => setFilterCommessa(e.target.value)}
                        className="pl-9 pr-4 py-2 border-none bg-white rounded-xl shadow-inner text-sm font-bold text-gray-700 focus:ring-2 focus:ring-blue-400 outline-none w-48"
                      >
                        <option value="">Tutte le commesse</option>
                        {commesse.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    </div>
                    
                    <div className="flex bg-gray-200/50 p-1.5 rounded-xl shadow-inner ml-2 border border-gray-100">
                      <button 
                        onClick={() => setIsCompact(false)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${!isCompact ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        <LayoutList className="w-4 h-4" /> Estesa
                      </button>
                      <button 
                        onClick={() => setIsCompact(true)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${isCompact ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        <LayoutGrid className="w-4 h-4" /> Compatta
                      </button>
                    </div>
                  </>
                )}
                
                {/* Selettore Vista Settimanale / Mensile per Stampa & Schermo */}
                <div className="flex bg-gray-200/50 p-1.5 rounded-xl shadow-inner ml-2 border border-gray-100">
                  <button 
                    onClick={() => setViewRange('mese')}
                    className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${viewRange === 'mese' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Vista Mensile
                  </button>
                  <button 
                    onClick={() => {
                      setViewRange('settimana');
                      setBaseDate(new Date());
                    }}
                    className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${viewRange === 'settimana' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Vista Settimanale
                  </button>
                </div>
              </div>

              {/* Navigazione Settimane & Stampa */}
              <div className="flex items-center gap-3 no-print">
                <div className="flex items-center gap-1 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm">
                  <button onClick={() => shiftWeek(-7)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600 transition"><ChevronLeft className="w-4 h-4" /></button>
                  <button onClick={resetToToday} className="px-3 py-1.5 text-xs font-extrabold text-gray-700 hover:bg-gray-100 rounded-lg transition">Oggi</button>
                  <button onClick={() => shiftWeek(7)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600 transition"><ChevronRight className="w-4 h-4" /></button>
                  <div className="h-5 w-px bg-gray-200 mx-1"></div>
                  <input type="date" value={baseDate.toISOString().split('T')[0]} onChange={e => setBaseDate(new Date(e.target.value))} className="text-xs font-bold border-none bg-transparent outline-none text-gray-700 cursor-pointer pl-1 pr-1" />
                </div>
                <button onClick={() => window.print()} className="flex items-center gap-2 bg-gray-900 text-white hover:bg-gray-800 px-4 py-2 rounded-xl text-sm font-bold transition shadow-md active:scale-95">
                  <Printer className="w-4 h-4" /> Stampa
                </button>
              </div>
            </div>

            {viewRange === 'settimana' && weeks[0] && (
              <div className="text-sm font-extrabold text-gray-700 bg-indigo-50/70 border border-indigo-100/60 px-4 py-2 rounded-xl flex items-center gap-2 self-start animate-in fade-in duration-200">
                <span>Settimana in esame:</span>
                <span className="text-indigo-700">{weeks[0].label} ({weeks[0].sub})</span>
              </div>
            )}

            {/* Legenda Colori per Vista Compatta */}
            {isCompact && (
              <div className="flex flex-wrap gap-3 pt-3 border-t border-gray-200/50 mt-1 no-print animate-in fade-in">
                <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider flex items-center mr-2">Legenda:</span>
                {commesse.map(c => (
                  <div key={c.id} className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-md shadow-sm border border-gray-100">
                    <span className="w-2.5 h-2.5 rounded-full shadow-inner" style={{backgroundColor: c.colore}}></span>
                    <span className="text-[11px] font-bold text-gray-700">{c.nome}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="w-full">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead className="sticky top-[80px] bg-white/95 backdrop-blur-md z-30 shadow-sm border-b-2 border-gray-200">
                <tr>
                  <th className="p-4 font-extrabold text-gray-900 w-1/6 sticky left-0 z-40 bg-white/95 backdrop-blur-md shadow-[1px_0_0_0_#e5e7eb]">Dipendente</th>
                  {viewRange === 'mese' ? (
                    weeks.map((wk, i) => {
                      const isCurrentWeek = wk.id === `${new Date().getFullYear()}-W${getWeekNumber(new Date())}`;
                      return (
                        <th key={i} className={`p-3 text-center border-l border-b-2 border-gray-200 w-1/6 ${isCurrentWeek ? 'bg-blue-50/50' : ''}`}>
                          <div className="font-extrabold text-gray-900">{wk.label}</div>
                          <div className="text-xs font-bold text-gray-500 mt-0.5">{wk.sub}</div>
                        </th>
                      );
                    })
                  ) : (
                    daysOfWeek.map((day, i) => {
                      const isToday = day.date.toDateString() === new Date().toDateString();
                      return (
                        <th key={i} className={`p-3 text-center border-l border-b-2 border-gray-200 w-1/6 ${isToday ? 'bg-indigo-50/50 border-indigo-200' : ''}`}>
                          <div className="font-extrabold text-gray-900">{day.label}</div>
                          <div className="text-xs font-bold text-gray-500 mt-0.5">
                            {day.date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
                          </div>
                        </th>
                      );
                    })
                  )}
                </tr>
              </thead>
              <tbody>
                {dipendentiDaMostrare.length === 0 ? (
                  <tr><td colSpan={viewRange === 'mese' ? weeks.length + 1 : 6} className="p-8 text-center text-gray-500 font-bold">Nessun dipendente trovato per i filtri selezionati.</td></tr>
                ) : (
                  dipendentiDaMostrare.map((dip, index) => (
                    <tr key={index} className="hover:bg-blue-50/30 transition-colors group">
                      <td className={`font-bold text-gray-800 bg-white sticky left-0 z-20 shadow-[1px_0_0_0_#f3f4f6] border-b border-gray-100 align-middle ${isCompact ? 'p-3' : 'p-4'}`}>{dip.nome}</td>
                      {viewRange === 'mese' ? (
                        weeks.map((wk, wIndex) => {
                          const key = `${dip.nome}-${wk.id}`;
                          const assList = assignments[key] || [];
                          const totalePercent = assList.reduce((t, c) => t + Number(c.percentuale), 0);
                          
                          let barColor = "bg-gray-200";
                          if(totalePercent > 0 && totalePercent < 100) barColor = "bg-yellow-400";
                          if(totalePercent === 100) barColor = "bg-green-500";
                          if(totalePercent > 100) barColor = "bg-red-500";

                          return (
                            <td 
                              key={wIndex} 
                              onClick={() => handleCellClick(dip.nome, wk.id, wk.label, wk.sub)}
                              className={`border-l border-b border-gray-100 transition-colors align-top bg-white ${(isAdmin || isSenior) ? 'cursor-pointer hover:bg-blue-50/80' : ''} ${isCompact ? 'p-1.5' : 'p-2'}`}
                            >
                              <div className={`flex flex-col items-center justify-start h-full relative group/cell ${isCompact ? 'min-h-[30px]' : 'min-h-[70px] pt-1'}`}>
                                
                                <div className="w-full flex justify-between items-center px-1.5 mb-1">
                                  <span className={`text-[10px] font-extrabold ${totalePercent > 100 ? 'text-red-600' : 'text-gray-500'}`}>{totalePercent}%</span>
                                  <div className="flex-1 h-1.5 bg-gray-100 ml-2 rounded-full overflow-hidden flex">
                                    {isCompact ? (
                                      assList.map((a, idx) => {
                                        const daysStr = a.giorni ? ` (${a.giorni.length === 5 ? 'Tutta la sett.' : a.giorni.join(', ')})` : '';
                                        return (
                                          <div key={idx} style={{width: `${a.percentuale}%`, backgroundColor: a.colore}} className="h-full border-r border-white/50 last:border-none" title={`${a.commessaName} (${a.percentuale}%)${daysStr}`}></div>
                                        );
                                      })
                                    ) : (
                                      <div className={`h-full ${barColor} rounded-full transition-all`} style={{width: `${Math.min(totalePercent, 100)}%`}}></div>
                                    )}
                                  </div>
                                </div>
                                
                                {(isAdmin || isSenior) && assList.length === 0 && (
                                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity">
                                    <span className="text-blue-400 font-bold text-xl">+</span>
                                  </div>
                                )}

                                {!isCompact && (
                                  <div className="w-full flex flex-col gap-1 px-1 relative z-10 mt-1">
                                    {assList.map((ass, aIndex) => (
                                      <div key={aIndex} className="text-[10px] flex flex-col p-1.5 rounded-md bg-white border border-gray-100 shadow-sm leading-tight w-full gap-1">
                                        <div className="flex items-center justify-between min-w-0 w-full">
                                          <div className="flex items-center min-w-0">
                                            <span className="w-1.5 h-1.5 rounded-full mr-1.5 shrink-0" style={{backgroundColor: ass.colore}}></span>
                                            <span className="truncate font-bold text-gray-700" title={ass.commessaName}>{ass.commessaName}</span>
                                          </div>
                                          <span className="ml-1 font-bold text-blue-600/80 shrink-0">{ass.percentuale}%</span>
                                        </div>
                                        {ass.giorni && ass.giorni.length > 0 && (
                                          <div className="text-[8px] text-gray-500 font-extrabold bg-gray-50 px-1 py-0.5 rounded text-left border border-gray-100/50">
                                            {ass.giorni.length === 5 ? 'Sett. Completa' : ass.giorni.join(', ')}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          );
                        })
                      ) : (
                        daysOfWeek.map((day, dIndex) => {
                          const currentWeek = weeks[0] || generateWeeks(baseDate)[0];
                          const key = `${dip.nome}-${currentWeek.id}`;
                          const weekAssList = assignments[key] || [];
                          const dayAssList = weekAssList.filter(a => a.giorni?.includes(day.key));
                          
                          const dayTotalePercent = dayAssList.reduce((acc, a) => {
                            const daysCount = a.giorni ? a.giorni.length : 0;
                            const perDayVal = daysCount > 0 ? a.percentuale / daysCount : 20;
                            return acc + perDayVal;
                          }, 0);

                          let barColor = "bg-gray-200";
                          if(dayTotalePercent > 0 && dayTotalePercent < 100) barColor = "bg-yellow-400";
                          if(dayTotalePercent === 100) barColor = "bg-green-500";
                          if(dayTotalePercent > 100) barColor = "bg-red-500";

                          return (
                            <td 
                              key={dIndex} 
                              onClick={() => handleCellClick(dip.nome, currentWeek.id, currentWeek.label, currentWeek.sub)}
                              className={`border-l border-b border-gray-100 transition-colors align-top bg-white ${(isAdmin || isSenior) ? 'cursor-pointer hover:bg-blue-50/80' : ''} ${isCompact ? 'p-1.5' : 'p-2'}`}
                            >
                              <div className={`flex flex-col items-center justify-start h-full relative group/cell ${isCompact ? 'min-h-[30px]' : 'min-h-[70px] pt-1'}`}>
                                
                                <div className="w-full flex justify-between items-center px-1.5 mb-1">
                                  <span className={`text-[10px] font-extrabold ${dayTotalePercent > 100 ? 'text-red-600' : 'text-gray-500'}`}>{dayTotalePercent}%</span>
                                  <div className="flex-1 h-1.5 bg-gray-100 ml-2 rounded-full overflow-hidden flex">
                                    {isCompact ? (
                                      dayAssList.map((a, idx) => {
                                        const daysCount = a.giorni ? a.giorni.length : 0;
                                        const perDayVal = daysCount > 0 ? a.percentuale / daysCount : 20;
                                        return (
                                          <div key={idx} style={{width: `${(perDayVal / Math.max(dayTotalePercent, 1)) * 100}%`, backgroundColor: a.colore}} className="h-full border-r border-white/50 last:border-none" title={`${a.commessaName} (${perDayVal}%)`}></div>
                                        );
                                      })
                                    ) : (
                                      <div className={`h-full ${barColor} rounded-full transition-all`} style={{width: `${Math.min(dayTotalePercent, 100)}%`}}></div>
                                    )}
                                  </div>
                                </div>
                                
                                {(isAdmin || isSenior) && dayAssList.length === 0 && (
                                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity">
                                    <span className="text-blue-400 font-bold text-xl">+</span>
                                  </div>
                                )}

                                {!isCompact && (
                                  <div className="w-full flex flex-col gap-1 px-1 relative z-10 mt-1">
                                    {dayAssList.map((ass, aIndex) => {
                                      const daysCount = ass.giorni ? ass.giorni.length : 0;
                                      const perDayVal = daysCount > 0 ? ass.percentuale / daysCount : 20;
                                      return (
                                        <div key={aIndex} className="text-[10px] flex flex-col p-1.5 rounded-md bg-white border border-gray-100 shadow-sm leading-tight w-full gap-1">
                                          <div className="flex items-center justify-between min-w-0 w-full">
                                            <div className="flex items-center min-w-0">
                                              <span className="w-1.5 h-1.5 rounded-full mr-1.5 shrink-0" style={{backgroundColor: ass.colore}}></span>
                                              <span className="truncate font-bold text-gray-700" title={ass.commessaName}>{ass.commessaName}</span>
                                            </div>
                                            <span className="ml-1 font-bold text-blue-600/80 shrink-0">{perDayVal}%</span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </td>
                          );
                        })
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CONTENUTO GRAFICI */}
      {activeTab === 'grafici' && (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-8 border border-white/50 no-print flex flex-col animate-in fade-in zoom-in-95 duration-200 mb-10">
          
          <div className="flex flex-wrap justify-between items-center mb-8 gap-4 border-b pb-6 border-gray-100">
            <h3 className="text-2xl font-extrabold text-gray-900 flex items-center gap-3">
              <div className="p-3 bg-indigo-100 rounded-2xl"><PieChart className="w-8 h-8 text-indigo-600" /></div>
              Analisi Dati
            </h3>
            
            <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-xl border border-gray-100 shadow-inner">
              <div className="flex flex-col">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider ml-1 mb-0.5">Da Data</label>
                <input 
                  type="date" 
                  value={chartStartDate} 
                  onChange={e => setChartStartDate(e.target.value)} 
                  className="text-sm font-bold border-none bg-white rounded-lg shadow-sm outline-none text-gray-700 cursor-pointer p-2" 
                />
              </div>
              <div className="h-8 w-px bg-gray-200"></div>
              <div className="flex flex-col">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider ml-1 mb-0.5">A Data</label>
                <input 
                  type="date" 
                  value={chartEndDate} 
                  onChange={e => setChartEndDate(e.target.value)} 
                  className="text-sm font-bold border-none bg-white rounded-lg shadow-sm outline-none text-gray-700 cursor-pointer p-2" 
                />
              </div>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <select 
              value={chartType} 
              onChange={e => setChartType(e.target.value as any)}
              className="p-3.5 border-none rounded-xl bg-gray-100/80 outline-none focus:ring-2 focus:ring-indigo-400 font-bold text-gray-700 shadow-inner"
            >
              <option value="dipendente">Analisi per Dipendente (Torta)</option>
              <option value="commessa">Analisi per Commessa (Barre)</option>
            </select>
            <select 
              value={chartTarget} 
              onChange={e => setChartTarget(e.target.value)}
              className="p-3.5 border-none rounded-xl bg-gray-100/80 outline-none focus:ring-2 focus:ring-indigo-400 font-bold text-gray-700 shadow-inner flex-1"
            >
              {chartType === 'dipendente' ? (
                dipendenti.map(d => <option key={d.id || d.nome} value={d.nome}>{d.nome}</option>)
              ) : (
                commesse.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)
              )}
            </select>
          </div>
          
          <div className="bg-gray-50/50 border border-gray-100 rounded-3xl p-6 h-[500px] flex items-center justify-center w-full relative shadow-inner">
            {chartType === 'dipendente' ? (
              <Pie data={getChartData() as any} options={{ maintainAspectRatio: false }} />
            ) : (
              <Bar data={getChartData() as any} options={{ maintainAspectRatio: false, indexAxis: 'y' }} />
            )}
          </div>
        </div>
      )}

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
