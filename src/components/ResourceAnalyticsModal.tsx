import { useState, useEffect, useMemo } from 'react';
import { X, Calendar, PieChart as PieChartIcon, BarChart3, ShieldAlert } from 'lucide-react';
import { db } from '../services/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { isCollaboratore, isSoci } from '../pages/Impostazioni';
import { rebuildYearlySummary } from '../services/yearlySummaryService';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Filler
} from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Filler
);

const MESI_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

interface ResourceAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  resource: {
    nome: string;
    email?: string;
    macroArea?: string;
    tipo?: string;
    oreContratto?: number;
    importoFissoMensile?: number;
    tariffaOraria?: number;
  } | null;
  allRequests: any[]; // hrRichieste (richieste_ferie)
  dipendenti: any[];
  onEnsureYearLoaded?: (year: number) => void;
}

export default function ResourceAnalyticsModal({
  isOpen,
  onClose,
  resource,
  allRequests,
  dipendenti,
  onEnsureYearLoaded
}: ResourceAnalyticsModalProps) {
  const currentYear = new Date().getFullYear();
  const availableYears = useMemo(() => {
    const years = [];
    for (let y = currentYear - 3; y <= currentYear; y++) {
      years.push(y);
    }
    return years;
  }, [currentYear]);

  const [startYear, setStartYear] = useState<number>(currentYear - 1);
  const [endYear, setEndYear] = useState<number>(currentYear);
  const [pieYear, setPieYear] = useState<number>(currentYear);
  const [trendMode, setTrendMode] = useState<'mensile' | 'annuale'>('mensile');
  const [rapportiniList, setRapportiniList] = useState<any[]>([]);

  const [yearlySummaries, setYearlySummaries] = useState<Record<number, any>>({});

  useEffect(() => {
    if (isOpen && onEnsureYearLoaded) {
      onEnsureYearLoaded(pieYear);
      for (let y = Math.min(startYear, endYear); y <= Math.max(startYear, endYear); y++) {
        onEnsureYearLoaded(y);
      }
    }
  }, [isOpen, pieYear, startYear, endYear, onEnsureYearLoaded]);

  // Carica i documenti di sintesi annuale compatti (storico_annuale_ferie/[year])
  useEffect(() => {
    if (!isOpen) return;
    const minY = Math.min(startYear, endYear);
    const maxY = Math.max(startYear, endYear);
    const yearsToFetch = Array.from(new Set([pieYear, minY, maxY]));

    yearsToFetch.forEach(async y => {
      if (yearlySummaries[y]) return;
      try {
        const docRef = doc(db, 'storico_annuale_ferie', String(y));
        const snap = await getDoc(docRef);
        if (snap.exists() && snap.data()?.employeeStats && Object.keys(snap.data().employeeStats).length > 0) {
          const data = snap.data();
          setYearlySummaries(prev => ({ ...prev, [y]: data }));
        } else {
          // Genera al volo se non esiste ancora su Firestore
          const newSummary = await rebuildYearlySummary(y, dipendenti);
          if (newSummary) {
            setYearlySummaries(prev => ({ ...prev, [y]: newSummary }));
          }
        }
      } catch (err) {
        console.error(`Errore recupero documento di sintesi ${y}:`, err);
        const newSummary = await rebuildYearlySummary(y, dipendenti);
        if (newSummary) {
          setYearlySummaries(prev => ({ ...prev, [y]: newSummary }));
        }
      }
    });
  }, [isOpen, pieYear, startYear, endYear, dipendenti]);

  const isCollab = useMemo(() => {
    if (!resource?.nome) return false;
    return isCollaboratore(resource.nome, dipendenti) || isSoci(resource.nome);
  }, [resource, dipendenti]);

  // Carica le presenze Firestore per la risorsa specifica
  useEffect(() => {
    if (!isOpen || !resource?.nome) return;

    let isMounted = true;
    const fetchRapportini = async () => {
      try {
        const qRapp = query(
          collection(db, 'presenze'),
          where('dipendenteNome', '==', resource.nome)
        );
        const snap = await getDocs(qRapp);
        const list: any[] = [];
        snap.forEach(docSnap => {
          list.push({ id: docSnap.id, ...docSnap.data() });
        });
        if (isMounted) {
          setRapportiniList(list);
        }
      } catch (err) {
        console.error("Errore recupero presenze per analisi risorsa:", err);
      }
    };

    fetchRapportini();
    return () => { isMounted = false; };
  }, [isOpen, resource?.nome]);

  // Reset range anni all'apertura
  useEffect(() => {
    if (isOpen) {
      setStartYear(currentYear - 1);
      setEndYear(currentYear);
      setPieYear(currentYear);
    }
  }, [isOpen, currentYear]);

  // Sincronizza pieYear quando cambia endYear
  useEffect(() => {
    setPieYear(endYear);
  }, [endYear]);

  // 1. Calcolo Tipologie Assenze per Donut Chart (Solo Dipendenti)
  const pieDataDetails = useMemo(() => {
    if (!resource?.nome || isCollab) return { ferie: 0, permessi: 0, malattia: 0, totale: 0 };

    const dipNameClean = resource.nome.trim().toLowerCase();

    // Se esiste la sintesi pre-aggregata dell'anno (1 sola lettura!), usa quella!
    const summary = yearlySummaries[pieYear];
    if (summary && summary.employeeStats && summary.employeeStats[dipNameClean]) {
      const stats = summary.employeeStats[dipNameClean];
      return {
        ferie: stats.ferie || 0,
        permessi: stats.permessi || 0,
        malattia: stats.malattia || 0,
        totale: stats.totale || 0
      };
    }

    const dipObj = dipendenti.find(d => d.nome && d.nome.trim().toLowerCase() === dipNameClean);
    const dailyContractHours = (dipObj && dipObj.oreSettimanali) ? (Number(dipObj.oreSettimanali) / 5) : 8;
    const halfDayContractHours = dailyContractHours / 2;
    
    // Richieste approvate per questo dipendente nell'anno selezionato (pieYear)
    const filteredReqs = allRequests.filter(r => {
      if (r.stato !== 'Approvato') return false;
      if (r.note === 'Chiusure Aziendali') return false;
      if ((r.dipendenteName || '').trim().toLowerCase() !== dipNameClean) return false;
      
      const reqYear = r.data ? Number(r.data.split('-')[0]) : (r.dataInizio ? Number(r.dataInizio.split('-')[0]) : 0);
      return reqYear === pieYear || (reqYear === 0);
    });

    let ferie = 0;
    let permessi = 0;
    let malattia = 0;

    filteredReqs.forEach(req => {
      const t = (req.tipo || '').toLowerCase();
      const isSmartWorking = t === 'smart' || t.includes('smart') || t.includes('lavoro da casa');

      // TASSATIVO: Il Lavoro da Casa (Smart Working) NON è un'assenza e va totalmente escluso!
      if (isSmartWorking) return;

      const dates: string[] = [];
      if (req.dataInizio && req.dataFine) {
        const [sY, sM, sD] = req.dataInizio.split('-').map(Number);
        const [eY, eM, eD] = req.dataFine.split('-').map(Number);
        if (!isNaN(sY) && !isNaN(eY)) {
          const curr = new Date(sY, sM - 1, sD);
          const end = new Date(eY, eM - 1, eD);
          while (curr <= end) {
            if (curr.getFullYear() === pieYear) {
              const year = curr.getFullYear();
              const month = String(curr.getMonth() + 1).padStart(2, '0');
              const day = String(curr.getDate()).padStart(2, '0');
              dates.push(`${year}-${month}-${day}`);
            }
            curr.setDate(curr.getDate() + 1);
          }
        }
      } else if (req.data) {
        const y = Number(req.data.split('-')[0]);
        if (y === pieYear) dates.push(req.data);
      }

      const numDays = dates.length || 1;
      const isPart = req.frazioneTipo === 'mattina' || req.frazioneTipo === 'pomeriggio';
      const isOrario = req.frazioneTipo === 'orario';

      let hours = 0;
      if (isOrario && req.oraInizio && req.oraFine) {
        const [h1, m1] = req.oraInizio.split(':').map(Number);
        const [h2, m2] = req.oraFine.split(':').map(Number);
        let diff = (h2 + m2 / 60) - (h1 + m1 / 60);
        if (req.pausaPranzo && req.pausaPranzoOre) {
          diff -= req.pausaPranzoOre;
        }
        hours = Math.max(0, diff);
      } else if (isPart) {
        hours = numDays * halfDayContractHours;
      } else {
        hours = numDays * dailyContractHours;
      }

      if (t === 'ferie' || t.includes('ferie')) {
        ferie += hours;
      } else if (t.includes('malattia') || t.includes('maternita') || t.includes('maternità') || t.includes('infortunio')) {
        malattia += hours;
      } else {
        // Tutto ciò che è un'assenza e non è Ferie né Malattia va sotto i Permessi (ROL, Orari, L.104, Donazione, Studio, ecc.)
        permessi += hours;
      }
    });

    const totale = ferie + permessi + malattia;
    return {
      ferie: Math.round(ferie * 10) / 10,
      permessi: Math.round(permessi * 10) / 10,
      malattia: Math.round(malattia * 10) / 10,
      totale: Math.round(totale * 10) / 10
    };
  }, [resource, allRequests, pieYear, isCollab]);

  // Data per Donut Chart (ChartJS) - 3 Voci Pulite: Ferie, Permessi, Malattia/Maternità
  const doughnutChartData = useMemo(() => {
    const hasData = pieDataDetails.totale > 0;
    return {
      labels: ['Ferie', 'Permessi', 'Malattia & Maternità'],
      datasets: [
        {
          data: hasData 
            ? [pieDataDetails.ferie, pieDataDetails.permessi, pieDataDetails.malattia]
            : [1, 0, 0],
          backgroundColor: hasData
            ? ['#10b981', '#f59e0b', '#ef4444']
            : ['#e2e8f0', '#e2e8f0', '#e2e8f0'],
          borderColor: '#ffffff',
          borderWidth: 3,
          hoverOffset: 6
        }
      ]
    };
  }, [pieDataDetails]);

  // 2. Trend Mensile Pluriannuale (Confronto tra startYear ed endYear)
  const trendData = useMemo(() => {
    const selectedYearsList: number[] = [];
    const minY = Math.min(startYear, endYear);
    const maxY = Math.max(startYear, endYear);
    for (let y = minY; y <= maxY; y++) {
      selectedYearsList.push(y);
    }

    const yearDataMap: Record<number, number[]> = {};

    selectedYearsList.forEach(yr => {
      yearDataMap[yr] = new Array(12).fill(0);
    });

    if (isCollab) {
      // Per Collaboratori P.IVA: Somma delle ore totali lavorate/fatturate al mese dai rapportini
      rapportiniList.forEach(sheet => {
        const yr = sheet.anno;
        const mo = sheet.mese; // 1-12
        if (selectedYearsList.includes(yr) && mo >= 1 && mo <= 12) {
          let totalHrs = 0;
          if (sheet.giorni && typeof sheet.giorni === 'object') {
            Object.values(sheet.giorni).forEach((g: any) => {
              if (g && typeof g.ore === 'number') {
                totalHrs += g.ore;
              }
            });
          }
          yearDataMap[yr][mo - 1] += totalHrs;
        }
      });
    } else {
      // Per Dipendenti: Somma delle ore di assenza (Ferie, Permessi, Malattia) al mese dalle richieste approvate
      const dipNameClean = (resource?.nome || '').trim().toLowerCase();

      // Anni per cui abbiamo già la sintesi pre-aggregata (1 sola lettura!)
      const processedYearsFromSummary = new Set<number>();
      selectedYearsList.forEach(yr => {
        const summary = yearlySummaries[yr];
        if (summary && summary.monthlyTrend && summary.monthlyTrend[dipNameClean]) {
          yearDataMap[yr] = [...summary.monthlyTrend[dipNameClean]];
          processedYearsFromSummary.add(yr);
        }
      });

      const dipObj = dipendenti.find(d => d.nome && d.nome.trim().toLowerCase() === dipNameClean);
      const dailyContractHours = (dipObj && dipObj.oreSettimanali) ? (Number(dipObj.oreSettimanali) / 5) : 8;
      const halfDayContractHours = dailyContractHours / 2;

      allRequests.forEach(req => {
        if (req.stato !== 'Approvato' || req.note === 'Chiusure Aziendali') return;
        if ((req.dipendenteName || '').trim().toLowerCase() !== dipNameClean) return;

        const reqTipo = (req.tipo || '').toLowerCase();
        if (reqTipo === 'smart' || reqTipo.includes('smart') || reqTipo.includes('lavoro da casa')) return;

        const dates: { year: number; month: number }[] = [];

        if (req.dataInizio && req.dataFine) {
          const [sY, sM, sD] = req.dataInizio.split('-').map(Number);
          const [eY, eM, eD] = req.dataFine.split('-').map(Number);
          if (!isNaN(sY) && !isNaN(eY)) {
            const curr = new Date(sY, sM - 1, sD);
            const end = new Date(eY, eM - 1, eD);
            while (curr <= end) {
              const yr = curr.getFullYear();
              if (selectedYearsList.includes(yr) && !processedYearsFromSummary.has(yr)) {
                dates.push({ year: yr, month: curr.getMonth() + 1 });
              }
              curr.setDate(curr.getDate() + 1);
            }
          }
        } else if (req.data) {
          const [sY, sM] = req.data.split('-').map(Number);
          if (selectedYearsList.includes(sY) && !processedYearsFromSummary.has(sY)) {
            dates.push({ year: sY, month: sM });
          }
        }

        const isPart = req.frazioneTipo === 'mattina' || req.frazioneTipo === 'pomeriggio';
        const isOrario = req.frazioneTipo === 'orario';

        let hoursPerDay = dailyContractHours;
        if (isOrario && req.oraInizio && req.oraFine) {
          const [h1, m1] = req.oraInizio.split(':').map(Number);
          const [h2, m2] = req.oraFine.split(':').map(Number);
          let diff = (h2 + m2 / 60) - (h1 + m1 / 60);
          if (req.pausaPranzo && req.pausaPranzoOre) diff -= req.pausaPranzoOre;
          hoursPerDay = Math.max(0, diff);
        } else if (isPart) {
          hoursPerDay = halfDayContractHours;
        }

        dates.forEach(d => {
          if (yearDataMap[d.year]) {
            yearDataMap[d.year][d.month - 1] += hoursPerDay;
          }
        });
      });
    }

    // Costruzione Datasets per ChartJS
    const palette = [
      { bg: 'rgba(99, 102, 241, 0.85)', border: '#4f46e5' },   // Indigo
      { bg: 'rgba(16, 185, 129, 0.85)', border: '#059669' },   // Emerald
      { bg: 'rgba(245, 158, 11, 0.85)', border: '#d97706' },   // Amber
      { bg: 'rgba(236, 72, 153, 0.85)', border: '#db2777' },   // Pink
    ];

    const datasets = selectedYearsList.map((yr, idx) => {
      const colors = palette[idx % palette.length];
      return {
        label: `Anno ${yr}`,
        data: yearDataMap[yr].map(val => Math.round(val * 10) / 10),
        backgroundColor: colors.bg,
        borderColor: colors.border,
        borderWidth: 2,
        borderRadius: 8,
        borderSkipped: false
      };
    });

    // Calcolo Totali Anno per Anno (per vista annuale)
    const yearlyTotalsList = selectedYearsList.map(yr => {
      const arr = yearDataMap[yr] || [];
      return Math.round(arr.reduce((a, b) => a + b, 0) * 10) / 10;
    });

    // Calcolo Totali Anno Corrente e Anno Precedente per KPI Card
    const endYearTotal = (yearDataMap[endYear] || []).reduce((a, b) => a + b, 0);
    const prevYearTotal = (yearDataMap[endYear - 1] || []).reduce((a, b) => a + b, 0);
    
    let diffPct = 0;
    if (prevYearTotal > 0) {
      diffPct = Math.round(((endYearTotal - prevYearTotal) / prevYearTotal) * 100);
    }

    return {
      selectedYearsList,
      datasets,
      yearlyTotalsList,
      endYearTotal: Math.round(endYearTotal * 10) / 10,
      prevYearTotal: Math.round(prevYearTotal * 10) / 10,
      diffPct
    };
  }, [startYear, endYear, isCollab, rapportiniList, allRequests, resource, yearlySummaries]);

  const barChartData = useMemo(() => {
    const palette = [
      { bg: 'rgba(99, 102, 241, 0.85)', border: '#4f46e5' },   // Indigo
      { bg: 'rgba(16, 185, 129, 0.85)', border: '#059669' },   // Emerald
      { bg: 'rgba(245, 158, 11, 0.85)', border: '#d97706' },   // Amber
      { bg: 'rgba(236, 72, 153, 0.85)', border: '#db2777' },   // Pink
    ];

    if (trendMode === 'annuale') {
      return {
        labels: trendData.selectedYearsList.map(y => `Anno ${y}`),
        datasets: [
          {
            label: isCollab ? 'Totale Ore Lavorate / Consuntivate' : 'Totale Ore Assenza',
            data: trendData.yearlyTotalsList,
            backgroundColor: trendData.selectedYearsList.map((_, idx) => palette[idx % palette.length].bg),
            borderColor: trendData.selectedYearsList.map((_, idx) => palette[idx % palette.length].border),
            borderWidth: 2,
            borderRadius: 10,
            borderSkipped: false
          }
        ]
      };
    }

    return {
      labels: MESI_SHORT,
      datasets: trendData.datasets
    };
  }, [trendMode, trendData, isCollab]);

  if (!isOpen || !resource) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200 no-print">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[96vh] border border-slate-100 flex flex-col overflow-hidden">
        
        {/* HEADER MODALE PREMIUM */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-purple-950 text-white p-4 sm:p-6 rounded-t-3xl relative overflow-hidden shrink-0">
          <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>
          
          <div className="flex justify-between items-start gap-4 relative z-10">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-xl font-black text-white shadow-inner shrink-0">
                {resource.nome.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-xl sm:text-2xl font-black tracking-tight text-white">{resource.nome}</h3>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    isCollab ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30' : 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/30'
                  }`}>
                    {isCollab ? 'Collaboratore P.IVA' : 'Dipendente'}
                  </span>
                </div>
                <p className="text-xs text-indigo-200/80 font-medium mt-0.5 flex items-center gap-2">
                  <span>✉️ {resource.email || 'Nessuna email'}</span>
                  <span>•</span>
                  <span>🏢 {resource.macroArea || 'Generico'}</span>
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl transition cursor-pointer shrink-0"
              title="Chiudi"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* CONTROLLI FILTRO INTERVALLO ANNI */}
          <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 relative z-10">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-bold text-indigo-200 flex items-center gap-1">
                <Calendar className="w-4 h-4 text-indigo-400" /> Intervallo Anni da Confrontare:
              </span>

              <div className="flex items-center gap-2 bg-white/10 p-1 rounded-2xl border border-white/15">
                <span className="text-[11px] font-bold text-gray-300 ml-1">Da:</span>
                <select
                  value={startYear}
                  onChange={e => setStartYear(Number(e.target.value))}
                  className="bg-slate-900 text-white border border-white/20 rounded-xl px-2 py-0.5 text-xs font-extrabold cursor-pointer focus:outline-none"
                >
                  {availableYears.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>

                <span className="text-[11px] font-bold text-gray-300">A:</span>
                <select
                  value={endYear}
                  onChange={e => setEndYear(Number(e.target.value))}
                  className="bg-slate-900 text-white border border-white/20 rounded-xl px-2 py-0.5 text-xs font-extrabold cursor-pointer focus:outline-none"
                >
                  {availableYears.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>

              {/* Pulsanti Preset Rapidi */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { setStartYear(currentYear - 1); setEndYear(currentYear); }}
                  className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white rounded-xl text-[11px] font-bold transition cursor-pointer"
                >
                  Ultimi 2 Anni
                </button>
                <button
                  type="button"
                  onClick={() => { setStartYear(currentYear - 2); setEndYear(currentYear); }}
                  className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white rounded-xl text-[11px] font-bold transition cursor-pointer"
                >
                  Ultimi 3 Anni
                </button>
              </div>
            </div>

            {/* Badge Riepilogativo KPI Fast View */}
            <div className="text-right">
              <span className="text-[10px] font-extrabold text-indigo-300 uppercase tracking-wider block">
                {isCollab ? `Totale Ore Lavorate (${endYear})` : `Totale Ore Assenza (${endYear})`}
              </span>
              <span className="text-xl font-black text-white">
                {trendData.endYearTotal} <span className="text-xs font-medium text-indigo-200">ore</span>
              </span>
            </div>
          </div>
        </div>

        {/* CORPO MODALE - GRAFICI & ANALISI (Scrollabile internamente se necessario) */}
        <div className="p-4 sm:p-5 space-y-4 bg-slate-50/50 flex-1 overflow-y-auto custom-scrollbar">
          
          {isCollab ? (
            /* VISTA DEDICATA AI COLLABORATORI P.IVA */
            <div className="space-y-4">
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 text-amber-900 text-xs font-semibold">
                <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
                <span>
                  <strong>Nota per Collaboratori in P.IVA:</strong> I collaboratori non registrano giorni di ferie o permessi contrattuali. Viene mostrato il grafico dell'andamento delle <strong>ore totali lavorate / prestazione mensile</strong> consuntivate a sistema nella <strong>bozza fattura</strong>.
                </span>
              </div>

              {/* Grafico Andamento Ore Pluriannuale Full-Width */}
              <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-xs space-y-3">
                <div className="flex justify-between items-center flex-wrap gap-2">
                  <div>
                    <h4 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-indigo-600" />
                      <span>{trendMode === 'mensile' ? 'Confronto Pluriannuale Ore Mensili' : 'Confronto Pluriannuale Ore Annuali'}</span>
                    </h4>
                  </div>

                  {/* Switcher Vista Mensile vs Annuale */}
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl border border-slate-200 shrink-0">
                    <button
                      type="button"
                      onClick={() => setTrendMode('mensile')}
                      className={`px-3 py-1 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                        trendMode === 'mensile' ? 'bg-white text-indigo-700 shadow-2xs font-black' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Vista Mensile
                    </button>
                    <button
                      type="button"
                      onClick={() => setTrendMode('annuale')}
                      className={`px-3 py-1 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                        trendMode === 'annuale' ? 'bg-white text-indigo-700 shadow-2xs font-black' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Vista Annuale
                    </button>
                  </div>
                </div>

                <div className="h-56 sm:h-60 w-full">
                  <Bar
                    data={barChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { position: 'top', labels: { font: { weight: 'bold' } } },
                        tooltip: { mode: 'index', intersect: false }
                      },
                      scales: {
                        y: { beginAtZero: true, grid: { color: '#f1f5f9' }, title: { display: true, text: 'Ore Totali' } },
                        x: { grid: { display: false } }
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            /* VISTA DEDICATA AI DIPENDENTI (DONUT + TREND) */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              
              {/* 1. GRAFICO DONUT (Ripartizione Assenze - lg:col-span-5) */}
              <div className="lg:col-span-5 bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-xs flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-1 flex-wrap gap-2">
                    <h4 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                      <PieChartIcon className="w-5 h-5 text-indigo-600" />
                      <span>Ripartizione Assenze ({pieYear})</span>
                    </h4>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={pieYear}
                        onChange={e => setPieYear(Number(e.target.value))}
                        className="bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl px-2 py-1 text-xs font-extrabold text-slate-800 cursor-pointer outline-none focus:ring-2 focus:ring-indigo-400"
                      >
                        {availableYears.map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 font-medium">
                    Distribuzione percentuale delle tipologie di assenza registrate (escluso lavoro da casa).
                  </p>
                </div>

                {pieDataDetails.totale === 0 ? (
                  <div className="py-10 text-center text-gray-400 italic text-xs font-bold border border-dashed border-gray-200 rounded-2xl">
                    Nessuna ora di assenza registrata per il {pieYear}.
                  </div>
                ) : (
                  <div className="relative h-44 sm:h-48 w-full flex items-center justify-center">
                    <Doughnut
                      data={doughnutChartData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '70%',
                        plugins: {
                          legend: { display: false },
                          tooltip: {
                            callbacks: {
                              label: (ctx) => `${ctx.label}: ${ctx.raw} ore`
                            }
                          }
                        }
                      }}
                    />
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xl font-black text-slate-900">{pieDataDetails.totale}</span>
                      <span className="text-[9px] font-bold text-gray-400 uppercase">Ore Totali</span>
                    </div>
                  </div>
                )}

                {/* Legenda Dettagliata in 3 Righe Orizzontali Pulite (Nessun testo a capo o troncato) */}
                <div className="space-y-1.5 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-emerald-50/70 border border-emerald-100 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0"></span>
                      <span className="font-bold text-emerald-950">Ferie</span>
                    </div>
                    <span className="font-black text-emerald-950">{pieDataDetails.ferie}h</span>
                  </div>

                  <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-amber-50/70 border border-amber-100 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0"></span>
                      <span className="font-bold text-amber-950">Permessi</span>
                    </div>
                    <span className="font-black text-amber-950">{pieDataDetails.permessi}h</span>
                  </div>

                  <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-rose-50/70 border border-rose-100 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0"></span>
                      <span className="font-bold text-rose-950">Malattia & Maternità</span>
                    </div>
                    <span className="font-black text-rose-950">{pieDataDetails.malattia}h</span>
                  </div>
                </div>
              </div>

              {/* 2. GRAFICO TREND BAR (Confronto Mensile / Annuale Pluriannuale - lg:col-span-7) */}
              <div className="lg:col-span-7 bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-xs flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-1 flex-wrap gap-2">
                    <h4 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-indigo-600" />
                      <span>{trendMode === 'mensile' ? 'Confronto Storico Assenze Mensili' : 'Confronto Storico Assenze Annuali'}</span>
                    </h4>

                    {/* Switcher Vista Mensile vs Annuale */}
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl border border-slate-200 shrink-0">
                      <button
                        type="button"
                        onClick={() => setTrendMode('mensile')}
                        className={`px-3 py-1 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                          trendMode === 'mensile' ? 'bg-white text-indigo-700 shadow-2xs font-black' : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        Vista Mensile
                      </button>
                      <button
                        type="button"
                        onClick={() => setTrendMode('annuale')}
                        className={`px-3 py-1 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                          trendMode === 'annuale' ? 'bg-white text-indigo-700 shadow-2xs font-black' : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        Vista Annuale
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 font-medium">
                    {trendMode === 'mensile'
                      ? 'Andamento mese per mese delle ore di assenza a confronto tra gli anni selezionati.'
                      : 'Totale complessivo delle ore di assenza registrate anno per anno.'}
                  </p>
                </div>

                <div className="h-56 sm:h-60 w-full">
                  <Bar
                    data={barChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { position: 'top', labels: { font: { weight: 'bold' } } },
                        tooltip: { mode: 'index', intersect: false }
                      },
                      scales: {
                        y: { beginAtZero: true, grid: { color: '#f1f5f9' }, title: { display: true, text: 'Ore Assenza' } },
                        x: { grid: { display: false } }
                      }
                    }}
                  />
                </div>
              </div>

            </div>
          )}

        </div>

        {/* FOOTER MODALE */}
        <div className="p-3 sm:p-4 bg-white border-t border-slate-100 flex justify-end shrink-0 rounded-b-3xl">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl shadow-md transition active:scale-95 cursor-pointer"
          >
            Chiudi Analisi
          </button>
        </div>

      </div>
    </div>
  );
}
