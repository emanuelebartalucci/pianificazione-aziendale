import React, { useState, useMemo } from 'react';
import { db } from '../services/firebase';
import { doc, setDoc, collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { rebuildYearlySummary } from '../services/yearlySummaryService';
import { FileSpreadsheet, X, RefreshCw, ShieldCheck, UserCheck, UserX, UploadCloud, Trash2, Download } from 'lucide-react';
import historicalLeavesData from '../data/historicalLeavesData.json';

interface Dipendente {
  id: string;
  nome: string;
  email?: string;
}

interface HistoricalImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  dipendenti: Dipendente[];
  onImportSuccess: () => void;
  showToast: (message: string, type?: 'success' | 'warning' | 'error') => void;
}

interface HistoricalRecord {
  dipendenteName: string;
  tipo: string;
  stato: string;
  dataInizio: string;
  dataFine: string;
  data: string;
  frazioneTipo: string;
  oraInizio?: string;
  oraFine?: string;
  note: string;
  importedFromExcel: boolean;
}

export const HistoricalImportModal: React.FC<HistoricalImportModalProps> = ({
  isOpen,
  onClose,
  dipendenti,
  onImportSuccess,
  showToast
}) => {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importedCount, setImportedCount] = useState(0);

  // Normalizza i nomi per il matching
  const norm = (s: string) => s.trim().toLowerCase();

  // Set dei dipendenti a sistema nel database
  const activeDbEmpMap = useMemo(() => {
    const map = new Map<string, string>(); // normName -> originalDbName
    dipendenti.forEach(d => {
      if (d.nome) {
        map.set(norm(d.nome), d.nome.trim());
      }
    });
    return map;
  }, [dipendenti]);

  // Calcolo analisi di importazione
  const analysis = useMemo(() => {
    const allItems = historicalLeavesData as HistoricalRecord[];
    const validItems: HistoricalRecord[] = [];
    const matchedDipSet = new Set<string>();
    const skippedDipSet = new Set<string>();

    const typeCounts: Record<string, number> = { ferie: 0, smart: 0, permesso: 0, malattia: 0 };
    const empItemCounts: Record<string, number> = {};

    allItems.forEach(item => {
      const dbMatchedName = activeDbEmpMap.get(norm(item.dipendenteName));
      if (dbMatchedName) {
        matchedDipSet.add(dbMatchedName);
        const copyItem = { ...item, dipendenteName: dbMatchedName };
        validItems.push(copyItem);

        typeCounts[item.tipo] = (typeCounts[item.tipo] || 0) + 1;
        empItemCounts[dbMatchedName] = (empItemCounts[dbMatchedName] || 0) + 1;
      } else {
        skippedDipSet.add(item.dipendenteName);
      }
    });

    return {
      validItems,
      matchedDipList: Array.from(matchedDipSet).sort(),
      skippedDipList: Array.from(skippedDipSet).sort(),
      typeCounts,
      empItemCounts,
      totalToImport: validItems.length
    };
  }, [activeDbEmpMap]);

  const [deleting, setDeleting] = useState(false);

  if (!isOpen) return null;

  const handleDeleteImportedHistory = async () => {
    if (!window.confirm("Sei sicuro di voler eliminare TUTTI i record importati dallo storico Excel? L'operazione ripulirà il database da tutti i dati importati.")) {
      return;
    }
    setDeleting(true);
    try {
      const q = query(collection(db, 'richieste_ferie'), where('importedFromExcel', '==', true));
      const snap = await getDocs(q);
      const docsToDelete: string[] = [];
      snap.forEach(d => docsToDelete.push(d.id));

      if (docsToDelete.length === 0) {
        showToast("Nessun dato importato da Excel trovato da eliminare.", "warning");
        setDeleting(false);
        return;
      }

      let count = 0;
      const chunkSize = 40;
      for (let i = 0; i < docsToDelete.length; i += chunkSize) {
        const chunk = docsToDelete.slice(i, i + chunkSize);
        await Promise.all(chunk.map(id => deleteDoc(doc(db, 'richieste_ferie', id))));
        count += chunk.length;
      }

      showToast(`Pulizia completata! Rimossi ${count} record importati dallo storico.`);
      
      // Rigenera automaticamente la sintesi per gli anni 2025 e 2026
      await rebuildYearlySummary(2025, dipendenti);
      await rebuildYearlySummary(2026, dipendenti);

      onImportSuccess();
      onClose();
    } catch (err) {
      console.error("Errore eliminazione storico importato:", err);
      showToast("Errore durante la pulizia dello storico importato.", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleExportCSVPreview = () => {
    if (analysis.validItems.length === 0) {
      showToast("Nessun dato valido da esportare per il controllo.", "warning");
      return;
    }

    const headers = ["Dipendente", "Tipo Assenza", "Stato", "Data Inizio", "Data Fine", "Note"];
    const rows = analysis.validItems.map(item => [
      `"${item.dipendenteName}"`,
      `"${item.tipo.toUpperCase()}"`,
      `"${item.stato}"`,
      `"${item.dataInizio}"`,
      `"${item.dataFine}"`,
      `"${item.note}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(";"), ...rows.map(r => r.join(";"))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Anteprima_Storico_Ferie_2025_2026.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast("Anteprima CSV scaricata con successo per il controllo.");
  };

  const handleExecuteImport = async () => {
    if (analysis.totalToImport === 0) {
      showToast("Nessun record da importare per i dipendenti registrati a sistema.", "warning");
      return;
    }

    setImporting(true);
    setProgress(0);
    setImportedCount(0);

    try {
      const items = analysis.validItems;
      const total = items.length;
      let count = 0;

      // Importazione a blocchi di 40 per evitare sovraccarico di connessione
      const chunkSize = 40;
      for (let i = 0; i < total; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async item => {
            const cleanName = item.dipendenteName.replace(/\s+/g, '_');
            // Genera ID deterministico idempotente per evitare duplicati
            const docId = `hist-${cleanName}-${item.dataInizio}-${item.tipo}`;
            const docRef = doc(db, 'richieste_ferie', docId);

            const payload: any = {
              dipendenteName: item.dipendenteName,
              tipo: item.tipo,
              stato: 'Approvato',
              dataInizio: item.dataInizio,
              dataFine: item.dataFine,
              data: item.data,
              frazioneTipo: item.frazioneTipo || 'giornata',
              note: item.note || 'Importato da Registro Storico Excel 2025-2026',
              importedFromExcel: true,
              importedAt: new Date().toISOString()
            };

            if (item.oraInizio) payload.oraInizio = item.oraInizio;
            if (item.oraFine) payload.oraFine = item.oraFine;

            await setDoc(docRef, payload, { merge: true });
          })
        );

        count += chunk.length;
        setProgress(Math.round((count / total) * 100));
        setImportedCount(count);
      }

      showToast(`Importazione completata con successo! Inseriti ${total} periodi nello storico ferie/assenze.`);

      // Rigenera automaticamente i documenti di sintesi per 2025 e 2026 basandosi direttamente sugli items validi
      await rebuildYearlySummary(2025, dipendenti, items);
      await rebuildYearlySummary(2026, dipendenti, items);

      onImportSuccess();
      onClose();
    } catch (err) {
      console.error("Errore durante l'importazione dello storico Excel:", err);
      showToast("Errore durante l'importazione dello storico. Verifica la connessione e riprova.", "error");
    } finally {
      setImporting(false);
    }
  };

  const handleRebuildSummariesOnly = async () => {
    try {
      setImporting(true);
      const items = analysis.validItems;
      showToast("Rigenerazione sintesi 2025 e 2026 in corso...");
      await rebuildYearlySummary(2025, dipendenti, items);
      await rebuildYearlySummary(2026, dipendenti, items);
      showToast("Documenti di sintesi 2025 e 2026 rigenerati con successo!");
      onImportSuccess();
      onClose();
    } catch (err) {
      console.error("Errore durante la rigenerazione delle sintesi:", err);
      showToast("Errore durante la rigenerazione della sintesi.", "error");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-indigo-950 p-6 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20">
              <FileSpreadsheet className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-black tracking-wide flex items-center gap-2">
                <span>Importatore Storico Ferie Excel</span>
                <span className="text-[10px] bg-emerald-500/30 text-emerald-300 font-extrabold px-2.5 py-0.5 rounded-full border border-emerald-400/30">2025 - Giugno 2026</span>
              </h3>
              <p className="text-xs text-teal-200/90 font-medium mt-0.5">
                Importazione guidata e consolidamento automatico nel database
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            disabled={importing}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar flex-1">

          {/* Info Card */}
          <div className="bg-emerald-50/60 border border-emerald-200 p-4.5 rounded-2xl flex items-start gap-3 text-emerald-950">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed font-medium">
              <span className="font-extrabold block text-emerald-900 text-sm mb-0.5">Controlli di Sicurezza Attivi:</span>
              - <strong>Luglio e Agosto 2026 esclusi</strong> per preservare i dati correnti del mese in corso.<br/>
              - <strong>Idempotente</strong>: l'importazione riconosce le voci già caricate senza duplicarle.<br/>
              - <strong>Risorse non presenti a sistema scartate</strong> automaticamente in sicurezza.
            </div>
          </div>

          {/* Metric Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-sky-50 border border-sky-200 p-3.5 rounded-2xl text-center">
              <span className="text-xs text-sky-700 font-bold block uppercase tracking-wider">Ferie</span>
              <span className="text-xl font-black text-sky-950">{analysis.typeCounts.ferie || 0}</span>
              <span className="text-[10px] text-sky-600 font-medium block">periodi</span>
            </div>
            <div className="bg-lime-50 border border-lime-200 p-3.5 rounded-2xl text-center">
              <span className="text-xs text-lime-700 font-bold block uppercase tracking-wider">Smart Work</span>
              <span className="text-xl font-black text-lime-950">{analysis.typeCounts.smart || 0}</span>
              <span className="text-[10px] text-lime-600 font-medium block">periodi</span>
            </div>
            <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-2xl text-center">
              <span className="text-xs text-amber-700 font-bold block uppercase tracking-wider">Permessi</span>
              <span className="text-xl font-black text-amber-950">{analysis.typeCounts.permesso || 0}</span>
              <span className="text-[10px] text-amber-600 font-medium block">richieste</span>
            </div>
            <div className="bg-rose-50 border border-rose-200 p-3.5 rounded-2xl text-center">
              <span className="text-xs text-rose-700 font-bold block uppercase tracking-wider">Malattia</span>
              <span className="text-xl font-black text-rose-950">{analysis.typeCounts.malattia || 0}</span>
              <span className="text-[10px] text-rose-600 font-medium block">periodi</span>
            </div>
          </div>

          {/* Matched vs Skipped Lists */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Dipendenti Riconosciuti */}
            <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50 flex flex-col max-h-52">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-black text-slate-800 uppercase flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-emerald-600" />
                  <span>Dipendenti Riconosciuti ({analysis.matchedDipList.length})</span>
                </span>
              </div>
              <div className="overflow-y-auto custom-scrollbar flex-1 space-y-1.5 pr-1">
                {analysis.matchedDipList.map(name => (
                  <div key={name} className="text-xs font-semibold text-slate-700 bg-white p-2 rounded-xl border border-slate-200 flex justify-between items-center shadow-2xs">
                    <span>{name}</span>
                    <span className="text-[10px] font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                      {analysis.empItemCounts[name]} periodi
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Risorse Escluse (Non in WebApp) */}
            <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50 flex flex-col max-h-52">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-black text-slate-800 uppercase flex items-center gap-1.5">
                  <UserX className="w-4 h-4 text-slate-400" />
                  <span>Non Registrati a Sistema ({analysis.skippedDipList.length})</span>
                </span>
                <span className="text-[9px] font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">Esclusi</span>
              </div>
              <div className="overflow-y-auto custom-scrollbar flex-1 space-y-1.5 pr-1">
                {analysis.skippedDipList.length > 0 ? (
                  analysis.skippedDipList.map(name => (
                    <div key={name} className="text-xs font-medium text-slate-400 bg-slate-100/70 p-2 rounded-xl border border-slate-200 flex justify-between items-center italic">
                      <span>{name}</span>
                      <span className="text-[9px] font-bold text-slate-400">Non censito</span>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-slate-400 italic text-center pt-6">Tutte le risorse negli Excel sono presenti a sistema.</div>
                )}
              </div>
            </div>

          </div>

          {/* Progress Bar (Visible during import) */}
          {importing && (
            <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-2xl space-y-2">
              <div className="flex justify-between items-center text-xs font-bold text-indigo-950">
                <span className="flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
                  Importazione in corso...
                </span>
                <span>{importedCount} / {analysis.totalToImport} ({progress}%)</span>
              </div>
              <div className="w-full bg-indigo-200/70 rounded-full h-2.5 overflow-hidden">
                <div 
                  className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="p-5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDeleteImportedHistory}
              disabled={importing || deleting}
              className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-extrabold rounded-xl border border-rose-200 text-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
              title="Elimina dal database tutti i dati precedentemente importati da Excel"
            >
              {deleting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-600" />
                  <span>Eliminazione...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  <span>Elimina Dati Importati</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleExportCSVPreview}
              disabled={importing}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold rounded-xl border border-slate-300 text-xs transition flex items-center gap-2 cursor-pointer"
              title="Scarica un file CSV con tutte le righe estratte per il controllo preventivo"
            >
              <Download className="w-3.5 h-3.5 text-slate-600" />
              <span>Scarica Anteprima CSV per Controllo</span>
            </button>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleRebuildSummariesOnly}
              disabled={importing}
              className="px-3.5 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 font-extrabold rounded-xl border border-indigo-200 text-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Rigenera i documenti di sintesi 2025 e 2026 basandosi sui dati storici senza dover cancellare né reimportare i record da zero"
            >
              <RefreshCw className="w-3.5 h-3.5 text-indigo-600" />
              <span>Rigenera Sintesi (Senza Reimportare)</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              disabled={importing}
              className="px-3 py-2.5 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-300 text-xs transition cursor-pointer disabled:opacity-50"
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={handleExecuteImport}
              disabled={importing || analysis.totalToImport === 0}
              className="w-1/2 sm:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs shadow-md transition active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {importing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Salvataggio...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>Conferma ed Esegui Importazione</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default HistoricalImportModal;
