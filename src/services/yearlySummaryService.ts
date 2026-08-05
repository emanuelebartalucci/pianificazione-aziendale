import { db } from './firebase';
import { collection, query, getDocs, doc, setDoc } from 'firebase/firestore';
import historicalLeavesData from '../data/historicalLeavesData.json';

export interface YearlySummaryData {
  year: number;
  updatedAt: string;
  employeeStats: Record<string, { ferie: number; permessi: number; malattia: number; smart: number; totale: number }>;
  monthlyTrend: Record<string, number[]>; // dipNameClean -> Array of 12 numbers (hours per month)
  compressedRequests: Array<{
    id: string;
    dipendenteName: string;
    tipo: string;
    stato: string;
    dataInizio: string;
    dataFine: string;
    frazioneTipo?: string;
    oraInizio?: string;
    oraFine?: string;
    note?: string;
  }>;
}

/**
 * Rigenera e salva in 1 sola scrittura il documento di sintesi annuale su `storico_annuale_ferie/[year]`.
 * Invocato automaticamente dopo importazioni, modifiche o eliminazioni.
 */
export async function rebuildYearlySummary(
  year: number, 
  dipendentiList: any[] = [], 
  sourceRequests?: any[]
): Promise<YearlySummaryData | null> {
  if (!dipendentiList || dipendentiList.length === 0) {
    console.warn("rebuildYearlySummary chiamato con lista dipendenti vuota. Operazione ignorata per sicurezza.");
    return null;
  }

  try {
    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;

    let requests: any[] = [];

    if (sourceRequests && sourceRequests.length > 0) {
      requests = sourceRequests.filter(r => {
        const dInizio = r.dataInizio || r.data || '';
        const dFine = r.dataFine || r.data || r.dataInizio || '';
        const rStato = r.stato || 'Approvato';
        const rNote = r.note || '';
        return rStato === 'Approvato' && rNote !== 'Chiusure Aziendali' && dFine >= startStr && dInizio <= endStr;
      });
    } else {
      try {
        const q = query(collection(db, 'richieste_ferie'));
        const snap = await getDocs(q);
        snap.forEach(d => {
          const data = d.data();
          const dInizio = data.dataInizio || data.data || '';
          const dFine = data.dataFine || data.data || data.dataInizio || '';
          if (data.stato === 'Approvato' && data.note !== 'Chiusure Aziendali' && dFine >= startStr && dInizio <= endStr) {
            requests.push({ id: d.id, ...data });
          }
        });
      } catch (err) {
        console.error("Errore lettura Firestore per sintesi:", err);
      }
    }

    // Se per l'anno (es. 2025 o inizio 2026) non abbiamo trovato elementi su Firestore o da sorgente,
    // integriamo con historicalLeavesData.json come sorgente storica garantita
    if (requests.length === 0 && historicalLeavesData && Array.isArray(historicalLeavesData)) {
      const histItems = historicalLeavesData.filter((r: any) => {
        const dInizio = r.dataInizio || r.data || '';
        const dFine = r.dataFine || r.data || r.dataInizio || '';
        const rStato = r.stato || 'Approvato';
        const rNote = r.note || '';
        return rStato === 'Approvato' && rNote !== 'Chiusure Aziendali' && dFine >= startStr && dInizio <= endStr;
      });
      requests = histItems;
    } else if (year === 2026 && historicalLeavesData && Array.isArray(historicalLeavesData)) {
      // Per il 2026 uniamo lo storico Excel (Gen-Giu) con le richieste correnti su Firestore
      const existingIds = new Set(requests.map(r => `${r.dipendenteName}_${r.dataInizio}_${r.tipo}`));
      const hist2026 = historicalLeavesData.filter((r: any) => {
        const dInizio = r.dataInizio || r.data || '';
        const dFine = r.dataFine || r.data || r.dataInizio || '';
        const key = `${r.dipendenteName}_${r.dataInizio}_${r.tipo}`;
        return dFine >= '2026-01-01' && dInizio <= '2026-06-30' && !existingIds.has(key);
      });
      requests = [...requests, ...hist2026];
    }

    const employeeStats: Record<string, { ferie: number; permessi: number; malattia: number; smart: number; totale: number }> = {};
    const monthlyTrend: Record<string, number[]> = {};

    dipendentiList.forEach(d => {
      if (d.nome) {
        const clean = d.nome.trim().toLowerCase();
        employeeStats[clean] = { ferie: 0, permessi: 0, malattia: 0, smart: 0, totale: 0 };
        monthlyTrend[clean] = new Array(12).fill(0);
      }
    });

    requests.forEach(req => {
      const dipNameClean = (req.dipendenteName || '').trim().toLowerCase();
      if (!dipNameClean) return;

      if (!employeeStats[dipNameClean]) {
        employeeStats[dipNameClean] = { ferie: 0, permessi: 0, malattia: 0, smart: 0, totale: 0 };
      }
      if (!monthlyTrend[dipNameClean]) {
        monthlyTrend[dipNameClean] = new Array(12).fill(0);
      }

      const t = (req.tipo || '').toLowerCase();
      const isSmartWorking = t === 'smart' || t.includes('smart') || t.includes('lavoro da casa');

      // Calcolo ore basato sul contratto del dipendente
      const dipObj = dipendentiList.find(d => d.nome && d.nome.trim().toLowerCase() === dipNameClean);
      const dailyContractHours = (dipObj && dipObj.oreSettimanali) ? (Number(dipObj.oreSettimanali) / 5) : 8;
      const halfDayContractHours = dailyContractHours / 2;

      const dates: { year: number; month: number }[] = [];
      if (req.dataInizio && req.dataFine) {
        const [sY, sM, sD] = req.dataInizio.split('-').map(Number);
        const [eY, eM, eD] = req.dataFine.split('-').map(Number);
        if (!isNaN(sY) && !isNaN(eY)) {
          const curr = new Date(sY, sM - 1, sD);
          const end = new Date(eY, eM - 1, eD);
          while (curr <= end) {
            if (curr.getFullYear() === year) {
              dates.push({ year, month: curr.getMonth() + 1 });
            }
            curr.setDate(curr.getDate() + 1);
          }
        }
      } else if (req.data) {
        const [sY, sM] = req.data.split('-').map(Number);
        if (sY === year) dates.push({ year, month: sM });
      }

      const numDays = dates.length || 1;
      const isPart = req.frazioneTipo === 'mattina' || req.frazioneTipo === 'pomeriggio';
      const isOrario = req.frazioneTipo === 'orario';

      let hours = 0;
      if (isOrario && req.oraInizio && req.oraFine) {
        const [h1, m1] = req.oraInizio.split(':').map(Number);
        const [h2, m2] = req.oraFine.split(':').map(Number);
        let diff = (h2 + m2 / 60) - (h1 + m1 / 60);
        if (req.pausaPranzo && req.pausaPranzoOre) diff -= req.pausaPranzoOre;
        hours = Math.max(0, diff);
      } else if (isPart) {
        hours = numDays * halfDayContractHours;
      } else {
        hours = numDays * dailyContractHours;
      }

      const hoursPerDay = numDays > 0 ? hours / numDays : hours;

      if (isSmartWorking) {
        employeeStats[dipNameClean].smart += hours;
      } else {
        if (t === 'ferie' || t.includes('ferie')) {
          employeeStats[dipNameClean].ferie += hours;
        } else if (t.includes('malattia') || t.includes('maternita') || t.includes('maternità') || t.includes('infortunio')) {
          employeeStats[dipNameClean].malattia += hours;
        } else {
          employeeStats[dipNameClean].permessi += hours;
        }
        employeeStats[dipNameClean].totale += hours;

        dates.forEach(d => {
          monthlyTrend[dipNameClean][d.month - 1] += hoursPerDay;
        });
      }
    });

    // Arrotondamento valori
    Object.keys(employeeStats).forEach(key => {
      const s = employeeStats[key];
      s.ferie = Math.round(s.ferie * 10) / 10;
      s.permessi = Math.round(s.permessi * 10) / 10;
      s.malattia = Math.round(s.malattia * 10) / 10;
      s.smart = Math.round(s.smart * 10) / 10;
      s.totale = Math.round(s.totale * 10) / 10;
    });

    Object.keys(monthlyTrend).forEach(key => {
      monthlyTrend[key] = monthlyTrend[key].map(v => Math.round(v * 10) / 10);
    });

    const compressedRequests = requests.map(r => ({
      id: r.id,
      dipendenteName: r.dipendenteName,
      tipo: r.tipo,
      stato: r.stato,
      dataInizio: r.dataInizio || r.data || '',
      dataFine: r.dataFine || r.data || '',
      frazioneTipo: r.frazioneTipo || 'giornata',
      oraInizio: r.oraInizio,
      oraFine: r.oraFine,
      note: r.note || ''
    }));

    const summaryPayload: YearlySummaryData = {
      year,
      updatedAt: new Date().toISOString(),
      employeeStats,
      monthlyTrend,
      compressedRequests
    };

    const docRef = doc(db, 'storico_annuale_ferie', String(year));
    await setDoc(docRef, summaryPayload);

    console.log(`Documento di Sintesi Annuale ${year} rigenerato con successo su Firestore (storico_annuale_ferie/${year})!`);
    return summaryPayload;
  } catch (err) {
    console.error(`Errore durante la rigenerazione della sintesi annuale per il ${year}:`, err);
    return null;
  }
}
