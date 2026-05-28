import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { Briefcase, Printer, ChevronLeft, ChevronRight, PieChart } from 'lucide-react';
import { generateWeeks, type WeekInfo, addDays, getWeekNumber } from '../utils/date';
import AssegnazioneModal from '../components/AssegnazioneModal';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js';
import { Pie, Bar } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

interface Assegnazione {
  commessaId: string;
  commessaName: string;
  percentuale: number;
  colore: string;
}

export default function Commesse() {
  const { isAdmin, isSenior, dipendenti, commesse, myAssociatedName } = useAuth();
  
  const [baseDate, setBaseDate] = useState<Date>(new Date());
  const [weeks, setWeeks] = useState<WeekInfo[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Assegnazione[]>>({});
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalData, setModalData] = useState({ dipendente: '', weekId: '', weekLabel: '', weekSub: '', currentAssignments: [] as Assegnazione[] });

  // Chart state
  const [chartType, setChartType] = useState<'dipendente' | 'commessa'>('dipendente');
  const [chartTarget, setChartTarget] = useState<string>('');

  useEffect(() => {
    setWeeks(generateWeeks(baseDate));
  }, [baseDate]);

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

  // Set default target per il grafico
  useEffect(() => {
    if (chartType === 'dipendente' && dipendenti.length > 0 && !chartTarget) {
      setChartTarget(myAssociatedName || dipendenti[0].nome);
    } else if (chartType === 'commessa' && commesse.length > 0 && (!chartTarget || !commesse.find(c => c.id === chartTarget))) {
      setChartTarget(commesse[0].id);
    }
  }, [chartType, dipendenti, commesse, myAssociatedName, chartTarget]);

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

  let dipendentiDaMostrare: {id?: string, nome: string}[] = dipendenti;
  if (!isAdmin && !isSenior) {
    if (myAssociatedName) {
      dipendentiDaMostrare = dipendenti.filter(d => d.nome === myAssociatedName);
    } else {
      dipendentiDaMostrare = [{nome: "Profilo in attesa di configurazione"}];
    }
  }

  // --- LOGICA GRAFICO ---
  const getChartData = () => {
    if (chartType === 'dipendente') {
      const dipNome = chartTarget;
      const dataMap: Record<string, { value: number, color: string }> = {};
      
      weeks.forEach(wk => {
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
        labels,
        datasets: [{
          data,
          backgroundColor: bgColors,
          borderWidth: 1,
        }]
      };
    } else {
      const commId = chartTarget;
      const comm = commesse.find(c => c.id === commId);
      const commName = comm ? comm.nome : commId;
      const dataMap: Record<string, number> = {};

      dipendentiDaMostrare.forEach(d => {
        let total = 0;
        weeks.forEach(wk => {
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
          label: `Impegno su ${commName} (%)`,
          data: Object.values(dataMap),
          backgroundColor: comm?.colore || '#3b82f6',
        }]
      };
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* TABELLA */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-8 border border-white/50 flex flex-col max-h-[75vh]">
        <div className="flex flex-wrap justify-between items-center mb-8 gap-4 border-b pb-4 border-gray-100">
          <h2 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-2xl no-print"><Briefcase className="text-blue-600 w-8 h-8" /></div>
            <span id="commesse-title">{(isAdmin || isSenior) ? "Pianificazione Aziendale" : "La tua Pianificazione"}</span>
          </h2>
          <div className="flex items-center gap-4 no-print">
            <button onClick={() => window.print()} className="flex items-center gap-2 bg-gray-900 text-white hover:bg-gray-800 px-5 py-2.5 rounded-xl font-bold transition shadow-md active:scale-95">
              <Printer className="w-5 h-5" /> Stampa
            </button>
            <div className="flex items-center gap-1 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm">
              <button onClick={() => shiftWeek(-7)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition"><ChevronLeft className="w-5 h-5" /></button>
              <button onClick={resetToToday} className="px-4 py-2 text-sm font-extrabold text-gray-700 hover:bg-gray-100 rounded-lg transition">Oggi</button>
              <button onClick={() => shiftWeek(7)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition"><ChevronRight className="w-5 h-5" /></button>
              <div className="h-6 w-px bg-gray-200 mx-1"></div>
              <input type="date" value={baseDate.toISOString().split('T')[0]} onChange={e => setBaseDate(new Date(e.target.value))} className="text-sm font-bold border-none bg-transparent outline-none text-gray-700 cursor-pointer pl-2 pr-1" />
            </div>
          </div>
        </div>
        
        <div className="overflow-auto flex-1 custom-scrollbar rounded-xl border border-gray-100">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead className="sticky top-0 bg-gray-50/95 backdrop-blur-sm z-10 shadow-sm">
              <tr>
                <th className="p-5 font-extrabold text-gray-900 w-1/6 border-b-2 border-gray-200 sticky left-0 z-20 bg-gray-50/95 backdrop-blur-sm shadow-[1px_0_0_0_#e5e7eb]">Dipendente</th>
                {weeks.map((wk, i) => {
                  const isCurrentWeek = wk.id === `${new Date().getFullYear()}-W${getWeekNumber(new Date())}`;
                  return (
                    <th key={i} className={`p-4 text-center border-l border-b-2 border-gray-200 w-1/6 ${isCurrentWeek ? 'bg-blue-50/50' : ''}`}>
                      <div className="font-extrabold text-gray-900">{wk.label}</div>
                      <div className="text-xs font-bold text-gray-500 mt-1">{wk.sub}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {dipendentiDaMostrare.map((dip, index) => (
                <tr key={index} className="hover:bg-blue-50/30 transition-colors">
                  <td className="p-5 font-bold text-gray-800 bg-white sticky left-0 shadow-[1px_0_0_0_#f3f4f6] border-b border-gray-100 align-top">{dip.nome}</td>
                  {weeks.map((wk, wIndex) => {
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
                        className={`p-2 border-l border-b border-gray-100 transition-colors align-top bg-white ${(isAdmin || isSenior) ? 'cursor-pointer hover:bg-blue-50/80' : ''}`}
                      >
                        <div className="flex flex-col items-center justify-start h-full min-h-[70px] pt-1 relative group/cell">
                          <div className="w-full flex justify-between items-center px-1.5 mb-2.5">
                            <span className={`text-xs font-extrabold ${totalePercent > 100 ? 'text-red-600' : 'text-gray-500'}`}>{totalePercent}%</span>
                            <div className="flex-1 h-1.5 bg-gray-100 ml-2 rounded-full overflow-hidden">
                              <div className={`h-full ${barColor} rounded-full transition-all`} style={{width: `${Math.min(totalePercent, 100)}%`}}></div>
                            </div>
                          </div>
                          
                          {(isAdmin || isSenior) && assList.length === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity">
                              <span className="text-blue-400 font-bold text-2xl">+</span>
                            </div>
                          )}

                          <div className="w-full flex flex-col gap-1.5 px-1 relative z-10">
                            {assList.map((ass, aIndex) => (
                              <div key={aIndex} className="text-[11px] flex items-center justify-between p-1.5 rounded-md bg-white border border-gray-100 shadow-sm leading-tight group-hover:border-blue-200 w-full">
                                <div className="flex items-center min-w-0">
                                  <span className="w-2 h-2 rounded-full mr-1.5 shrink-0" style={{backgroundColor: ass.colore}}></span>
                                  <span className="truncate font-semibold text-gray-700" title={ass.commessaName}>{ass.commessaName}</span>
                                </div>
                                <span className="ml-1.5 font-bold text-blue-600/80 shrink-0">{ass.percentuale}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* GRAFICI */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-8 border border-white/50 no-print">
        <h3 className="text-2xl font-extrabold text-gray-900 mb-6 flex items-center gap-3">
          <div className="p-3 bg-indigo-100 rounded-2xl"><PieChart className="w-8 h-8 text-indigo-600" /></div>
          Analisi Assegnazioni <span className="text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-xl ml-2">{weeks[0]?.sub} / {weeks[4]?.sub}</span>
        </h3>
        
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
              dipendentiDaMostrare.map(d => <option key={d.id || d.nome} value={d.nome}>{d.nome}</option>)
            ) : (
              commesse.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)
            )}
          </select>
        </div>
        
        <div className="bg-gray-50/50 border border-gray-100 rounded-3xl p-6 h-96 flex items-center justify-center w-full relative shadow-inner">
          {chartType === 'dipendente' ? (
            <Pie data={getChartData() as any} options={{ maintainAspectRatio: false }} />
          ) : (
            <Bar data={getChartData() as any} options={{ maintainAspectRatio: false, indexAxis: 'y' }} />
          )}
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
        currentAssignments={modalData.currentAssignments}
      />
    </div>
  );
}
