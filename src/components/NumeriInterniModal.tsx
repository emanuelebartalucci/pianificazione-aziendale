import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  Phone, 
  Search, 
  Printer, 
  Pencil, 
  Save, 
  RotateCcw, 
  Plus, 
  Trash2, 
  Building2, 
  Flame, 
  HeartPulse, 
  KeyRound, 
  AlertCircle
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { APP_VERSION, getPrintDateString } from '../config/version';

export interface ContattoInterno {
  id: string;
  ufficio: string;
  nominativo: string;
  numero: string;
  note?: string;
  categoria?: 'ufficio' | 'sicurezza' | 'servizio';
}

export interface SezioneSede {
  id: string;
  sede: string;
  piano?: string;
  contatti: ContattoInterno[];
}

export const DEFAULT_NUMERI_INTERNI: SezioneSede[] = [
  {
    id: 'sede-gramsci',
    sede: 'Sede Via Gramsci',
    piano: '',
    contatti: [
      { id: 'g-1', ufficio: 'Centralino', nominativo: 'Lapi Lucia – Giusti Lorenzo', numero: '200', categoria: 'servizio' },
      { id: 'g-2', ufficio: 'Amministrazione', nominativo: 'Brotini Lucrezia', numero: '101', categoria: 'ufficio' },
      { id: 'g-3', ufficio: 'Ufficio HR', nominativo: 'Ballerini Chiara', numero: '102', categoria: 'ufficio' },
      { id: 'g-4', ufficio: 'Ufficio IT / Commerciale', nominativo: 'Lucchesi Paolo', numero: '103', categoria: 'ufficio' },
      { id: 'g-5', ufficio: 'Ufficio Sicurezza / RSPP', nominativo: 'Votino Federica', numero: '120', categoria: 'ufficio' },
      { id: 'g-6', ufficio: 'Ufficio Sicurezza / RSPP', nominativo: 'Fasano Lara – Cecca Antonella – Parenti Enrico', numero: '121', categoria: 'ufficio' },
      { id: 'g-7', ufficio: 'Addetto Antincendio', nominativo: 'Parenti Enrico – Lucchesi Paolo', numero: '121 – 103', categoria: 'sicurezza' },
      { id: 'g-8', ufficio: 'Addetto Primo Soccorso', nominativo: 'Fasano Lara – Ballerini Chiara', numero: '121 – 102', categoria: 'sicurezza' }
    ]
  },
  {
    id: 'sede-diaz-pt',
    sede: 'Sede Via Diaz',
    piano: 'Piano Terreno',
    contatti: [
      { id: 'dpt-1', ufficio: 'Ufficio 3', nominativo: 'Bartalucci Emanuele', numero: '201', categoria: 'ufficio' },
      { id: 'dpt-2', ufficio: 'Ufficio 3', nominativo: 'Tempone Giulia', numero: '202', categoria: 'ufficio' },
      { id: 'dpt-3', ufficio: 'Ufficio 4', nominativo: 'Postazione Libera', numero: '203', categoria: 'servizio' },
      { id: 'dpt-4', ufficio: 'Ufficio 4', nominativo: 'Corbellini Matteo', numero: '204', categoria: 'ufficio' },
      { id: 'dpt-5', ufficio: 'Sala Riunioni', nominativo: 'Presidio Riunioni', numero: '205', categoria: 'servizio' },
      { id: 'dpt-6', ufficio: 'Ufficio 6', nominativo: 'Ostuni Riccardo – Signorini Leonardo', numero: '206', categoria: 'ufficio' },
      { id: 'dpt-7', ufficio: 'Ufficio 6', nominativo: 'Matteoli Samuele – Gori Matteo – Stefanelli Alessandro', numero: '207', categoria: 'ufficio' },
      { id: 'dpt-8', ufficio: 'Ufficio 7', nominativo: 'Romanello Andrea', numero: '208', categoria: 'ufficio' },
      { id: 'dpt-9', ufficio: 'Ufficio 7', nominativo: 'Rocchini Carlotta – Pranzile Daniele', numero: '209', categoria: 'ufficio' }
    ]
  },
  {
    id: 'sede-diaz-p1',
    sede: 'Sede Via Diaz',
    piano: 'Piano Primo',
    contatti: [
      { id: 'dp1-1', ufficio: 'Ufficio 13', nominativo: 'Rossi Niccolò', numero: '220', categoria: 'ufficio' },
      { id: 'dp1-2', ufficio: 'Ufficio 13', nominativo: 'Critelli Federica', numero: '221', categoria: 'ufficio' },
      { id: 'dp1-3', ufficio: 'Ufficio 14', nominativo: 'Cappelli Marco', numero: '222', categoria: 'ufficio' },
      { id: 'dp1-4', ufficio: 'Ufficio 14', nominativo: 'Turi Francesca', numero: '223', categoria: 'ufficio' },
      { id: 'dp1-5', ufficio: 'Ufficio 15', nominativo: 'Orsi Giovanni – Stefanelli Luca', numero: '224', categoria: 'ufficio' },
      { id: 'dp1-6', ufficio: 'Ufficio 15', nominativo: 'Sabatini Thomas', numero: '225', categoria: 'ufficio' },
      { id: 'dp1-7', ufficio: 'Ufficio 15', nominativo: 'Taddei Paolo', numero: '226', categoria: 'ufficio' },
      { id: 'dp1-8', ufficio: 'Ufficio 16', nominativo: 'Badalassi Federico', numero: '227', categoria: 'ufficio' },
      { id: 'dp1-9', ufficio: 'Ufficio 16', nominativo: 'Menichetti Leonardo', numero: '228', categoria: 'ufficio' },
      { id: 'dp1-10', ufficio: 'Ufficio 16', nominativo: 'Calugi Marta – Menichetti Giulia', numero: '229', categoria: 'ufficio' },
      { id: 'dp1-11', ufficio: 'Ufficio 18', nominativo: 'Profeti Andrea', numero: '230', categoria: 'ufficio' },
      { id: 'dp1-12', ufficio: 'Addetto Antincendio', nominativo: 'Corbellini Matteo – Profeti Andrea', numero: '204 – 230', categoria: 'sicurezza' },
      { id: 'dp1-13', ufficio: 'Addetto Primo Soccorso', nominativo: 'Profeti Andrea – Corbellini Matteo', numero: '230 – 204', categoria: 'sicurezza' },
      { id: 'dp1-14', ufficio: 'Conference Room', nominativo: 'Sala Conferenze', numero: '290', note: 'PIN: 1234', categoria: 'servizio' }
    ]
  }
];

interface NumeriInterniModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NumeriInterniModal({ isOpen, onClose }: NumeriInterniModalProps) {
  const { isDev, userEmail } = useAuth();

  const [sezioni, setSezioni] = useState<SezioneSede[]>(DEFAULT_NUMERI_INTERNI);
  const [isEditing, setIsEditing] = useState(false);
  const [draftSezioni, setDraftSezioni] = useState<SezioneSede[]>(DEFAULT_NUMERI_INTERNI);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false);
      setSearchQuery('');
      return;
    }

    const fetchNumeri = async () => {
      try {
        const docRef = doc(db, 'sistema', 'numeri_interni');
        const snap = await getDoc(docRef);
        if (snap.exists() && Array.isArray(snap.data()?.sezioni) && snap.data().sezioni.length > 0) {
          setSezioni(snap.data().sezioni);
          setDraftSezioni(snap.data().sezioni);
        } else {
          setSezioni(DEFAULT_NUMERI_INTERNI);
          setDraftSezioni(DEFAULT_NUMERI_INTERNI);
        }
      } catch (err) {
        console.error('Errore fetch numeri interni da Firestore:', err);
        setSezioni(DEFAULT_NUMERI_INTERNI);
        setDraftSezioni(DEFAULT_NUMERI_INTERNI);
      }
    };

    fetchNumeri();
  }, [isOpen]);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const filteredSezioni = useMemo(() => {
    const listToFilter = isEditing ? draftSezioni : sezioni;
    if (!searchQuery.trim()) return listToFilter;

    const q = searchQuery.toLowerCase().trim();
    return listToFilter.map(sez => {
      const matchingContatti = sez.contatti.filter(c => 
        c.ufficio.toLowerCase().includes(q) ||
        c.nominativo.toLowerCase().includes(q) ||
        c.numero.toLowerCase().includes(q) ||
        (c.note && c.note.toLowerCase().includes(q))
      );
      return {
        ...sez,
        contatti: matchingContatti
      };
    }).filter(sez => sez.contatti.length > 0);
  }, [sezioni, draftSezioni, isEditing, searchQuery]);

  const handleSaveToFirestore = async () => {
    setIsSaving(true);
    try {
      const docRef = doc(db, 'sistema', 'numeri_interni');
      await setDoc(docRef, {
        sezioni: draftSezioni,
        updatedAt: new Date().toISOString(),
        updatedBy: userEmail || 'developer'
      }, { merge: true });

      setSezioni(draftSezioni);
      setIsEditing(false);
      showToast('Elenco numeri interni salvato con successo su database!');
    } catch (err) {
      console.error('Errore salvataggio numeri interni:', err);
      showToast('Errore durante il salvataggio dei dati.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefault = () => {
    if (window.confirm('Sei sicuro di voler ripristinare l\'elenco predefinito di fabbrica? Le modifiche non salvate andranno perse.')) {
      setDraftSezioni(DEFAULT_NUMERI_INTERNI);
      showToast('Ripristinati i dati predefiniti. Clicca Salva Modifiche per confermarli sul database.');
    }
  };

  const handleUpdateContact = (sezId: string, contId: string, field: keyof ContattoInterno, value: string) => {
    setDraftSezioni(prev => prev.map(sez => {
      if (sez.id !== sezId) return sez;
      return {
        ...sez,
        contatti: sez.contatti.map(c => {
          if (c.id !== contId) return c;
          return { ...c, [field]: value };
        })
      };
    }));
  };

  const handleAddContact = (sezId: string) => {
    const newId = `c-${Date.now()}`;
    setDraftSezioni(prev => prev.map(sez => {
      if (sez.id !== sezId) return sez;
      return {
        ...sez,
        contatti: [
          ...sez.contatti,
          { id: newId, ufficio: 'Nuovo Ufficio', nominativo: 'Cognome e Nome', numero: '000', categoria: 'ufficio' }
        ]
      };
    }));
  };

  const handleDeleteContact = (sezId: string, contId: string) => {
    setDraftSezioni(prev => prev.map(sez => {
      if (sez.id !== sezId) return sez;
      return {
        ...sez,
        contatti: sez.contatti.filter(c => c.id !== contId)
      };
    }));
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const currentData = isEditing ? draftSezioni : sezioni;

    const sectionsHtml = currentData.map((sez) => {
      const headerTitle = sez.piano ? `${sez.sede} — ${sez.piano}` : sez.sede;
      
      const rows = sez.contatti.map((c, idx) => {
        const isAlternate = idx % 2 === 1;
        const rowBg = isAlternate ? 'background-color: #f8fafc;' : 'background-color: #ffffff;';
        const isSicurezza = c.categoria === 'sicurezza';

        const noteBadge = c.note ? `<span style="display: inline-block; background-color: #fef3c7; color: #92400e; padding: 1px 5px; border-radius: 3px; font-size: 7.5pt; font-weight: 800; margin-left: 6px; border: 1px solid #fde68a; vertical-align: middle;">${c.note}</span>` : '';

        return `
          <tr style="${rowBg}">
            <td style="padding: 3px 6px; border: 1px solid #cbd5e1; font-weight: ${isSicurezza ? '800' : '700'}; color: ${isSicurezza ? '#991b1b' : '#0f172a'}; width: 34%; font-size: 8.5pt; vertical-align: middle;">
              ${c.ufficio}
            </td>
            <td style="padding: 3px 6px; border: 1px solid #cbd5e1; font-weight: 600; color: #334155; width: 50%; font-size: 8.5pt; vertical-align: middle;">
              ${c.nominativo} ${noteBadge}
            </td>
            <td style="padding: 3px 6px; border: 1px solid #cbd5e1; font-weight: 900; color: #1e40af; text-align: center; width: 16%; font-size: 9.5pt; letter-spacing: 0.3px; vertical-align: middle; background-color: ${isAlternate ? '#f0f7ff' : '#f8fbff'};">
              ${c.numero}
            </td>
          </tr>
        `;
      }).join('');

      return `
        <div style="margin-bottom: 6px; border-radius: 4px; overflow: hidden; border: 1px solid #94a3b8; page-break-inside: avoid;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #ffffff; padding: 3px 8px; font-size: 8pt; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #2563eb;">
            <span>🏢 ${headerTitle}</span>
            <span style="opacity: 0.9; font-size: 7pt; font-weight: 700; background: rgba(255,255,255,0.18); padding: 1px 5px; border-radius: 3px;">${sez.contatti.length} interni</span>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 8pt;">
            <thead>
              <tr style="background-color: #f1f5f9; color: #475569; text-transform: uppercase; font-size: 7pt; font-weight: 800; letter-spacing: 0.4px;">
                <th style="padding: 2.5px 6px; border: 1px solid #cbd5e1; text-align: left; width: 34%;">Ufficio / Ruolo</th>
                <th style="padding: 2.5px 6px; border: 1px solid #cbd5e1; text-align: left; width: 50%;">Nominativo (Cognome e Nome)</th>
                <th style="padding: 2.5px 6px; border: 1px solid #cbd5e1; text-align: center; width: 16%;">Numero Interno</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `;
    }).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="it">
      <head>
        <meta charset="UTF-8">
        <title>Numeri Telefonici Interni — INGEGNO P&C S.R.L.</title>
        <style>
          @page { size: A4 portrait; margin: 6mm 8mm 4mm 8mm; }
          * { box-sizing: border-box !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body { margin: 0 !important; padding: 0 !important; height: 100%; overflow: hidden !important; background: #ffffff !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 8.5pt; color: #111827; }
          
          table.main-layout { width: 100%; border-collapse: collapse; border: none; }
          table.main-layout > thead > tr > td { padding: 0; border: none; }
          table.main-layout > tbody > tr > td { padding: 0; border: none; }
          table.main-layout > tfoot > tr > td { padding: 0; border: none; }

          .header-bar { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 5px; margin-bottom: 8px; border-bottom: 2px solid #0f172a; }
          .header-logo { height: 38px; width: auto; }
          .header-title-right { text-align: right; font-size: 8.5pt; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; }
          
          .title-banner { background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); color: #ffffff; padding: 5px 12px; border-radius: 4px; display: flex; justify-content: center; align-items: center; text-align: center; margin-bottom: 8px; }
          .title-banner-text { font-size: 10pt; font-weight: 900; text-transform: uppercase; letter-spacing: 0.8px; text-align: center; }

          .print-footer-static { margin-top: 4px; padding-top: 3px; padding-bottom: 2px; border-top: 1px solid #94a3b8; display: flex; justify-content: space-between; align-items: center; font-size: 7.5pt; font-weight: 600; color: #475569; font-family: monospace; }
          .page-number::after { content: counter(page); }
        </style>
      </head>
      <body>
        <table class="main-layout">
          <thead>
            <tr>
              <td>
                <div class="header-bar">
                  <img src="/Logo.png" alt="Logo Ingegno" class="header-logo" />
                  <div class="header-title-right">INGEGNO P&C S.R.L. · ELENCO NUMERI INTERNI</div>
                </div>
                <div class="title-banner">
                  <span class="title-banner-text">RUBRICA NUMERI TELEFONICI INTERNI</span>
                </div>
              </td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                ${sectionsHtml}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>
                <div class="print-footer-static">
                  <span>Piattaforma Pianificazione Aziendale</span>
                  <span>${APP_VERSION} — Data Stampa: ${getPrintDateString()}</span>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>

        <script>
          function closeWindow() { try { window.close(); } catch(e) {} }
          window.onafterprint = closeWindow;
          window.onload = function() { setTimeout(function() { window.print(); closeWindow(); setTimeout(closeWindow, 500); }, 250); };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* HEADER MODALE */}
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 text-white p-5 sm:p-6 flex items-center justify-between shadow-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center text-white shadow-inner shrink-0">
              <Phone className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg sm:text-xl font-black tracking-tight flex items-center gap-2">
                Numeri Telefonici Interni
              </h3>
              <p className="text-xs text-blue-100/80 font-medium mt-0.5">
                Rubrica rapida degli interni aziendali di tutte le sedi operative.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Pulsante Stampa */}
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white px-3.5 py-2 rounded-xl text-xs font-extrabold transition shadow-xs cursor-pointer active:scale-95"
              title="Stampa elenco A4 o salva PDF"
            >
              <Printer className="w-4 h-4" />
              <span className="hidden sm:inline">Stampa Elenco</span>
            </button>

            {/* Pulsante Modalità Modifica per Sviluppatori */}
            {isDev && (
              <button
                type="button"
                onClick={() => {
                  if (isEditing) {
                    setDraftSezioni(sezioni);
                    setIsEditing(false);
                  } else {
                    setDraftSezioni(JSON.parse(JSON.stringify(sezioni)));
                    setIsEditing(true);
                  }
                }}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-extrabold transition shadow-xs cursor-pointer active:scale-95 ${
                  isEditing 
                    ? 'bg-amber-400 text-amber-950 hover:bg-amber-300' 
                    : 'bg-white/15 hover:bg-white/25 text-white'
                }`}
                title="Attiva modalità modifica per sviluppatori"
              >
                <Pencil className="w-4 h-4" />
                <span className="hidden sm:inline">{isEditing ? 'Annulla Modifica' : 'Modifica (Dev)'}</span>
              </button>
            )}

            {/* Pulsante Chiudi */}
            <button
              type="button"
              onClick={onClose}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-white transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* BARRA DI RICERCA & CONTROLLI DEV */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="relative w-full sm:w-96">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cerca per cognome, nome, ufficio o numero interno..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 placeholder:font-normal focus:ring-2 focus:ring-blue-500 outline-none shadow-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 hover:text-slate-600 px-1.5 py-0.5 bg-slate-100 rounded cursor-pointer"
              >
                Azzera
              </button>
            )}
          </div>

          {/* Azioni Dev quando in modalità modifica */}
          {isDev && isEditing && (
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={handleResetToDefault}
                className="flex items-center gap-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer"
                title="Ripristina valori di default"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Ripristina Default
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveToFirestore}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded-xl text-xs font-extrabold shadow-sm transition cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" /> {isSaving ? 'Salvataggio...' : 'Salva Modifiche'}
              </button>
            </div>
          )}
        </div>

        {/* TOAST FEEDBACK */}
        {toastMessage && (
          <div className={`px-4 py-2 text-xs font-bold text-white flex items-center justify-between animate-in slide-in-from-top duration-150 ${
            toastMessage.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
          }`}>
            <span>{toastMessage.text}</span>
            <button onClick={() => setToastMessage(null)} className="cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* CORPO MODALE CON LE SCHEDE PER SEDE */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {filteredSezioni.length === 0 ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-2">
              <AlertCircle className="w-8 h-8 text-slate-300" />
              <p className="text-sm font-bold">Nessun numero interno corrispondente alla ricerca "{searchQuery}".</p>
            </div>
          ) : (
            filteredSezioni.map((sez) => {
              const headerTitle = sez.piano ? `${sez.sede} — ${sez.piano}` : sez.sede;

              return (
                <div 
                  key={sez.id} 
                  className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden"
                >
                  {/* Testata Sezione Sede */}
                  <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-blue-400" />
                      <h4 className="text-xs sm:text-sm font-black uppercase tracking-wider">
                        {headerTitle}
                      </h4>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10.5px] font-extrabold bg-white/10 px-2 py-0.5 rounded-lg text-slate-200">
                        {sez.contatti.length} interni
                      </span>
                      {isDev && isEditing && (
                        <button
                          type="button"
                          onClick={() => handleAddContact(sez.id)}
                          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-lg transition cursor-pointer"
                        >
                          <Plus className="w-3 h-3" /> Aggiungi
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Griglia Contatti */}
                  <div className="divide-y divide-slate-100">
                    {sez.contatti.map((c) => {
                      const isSicurezza = c.categoria === 'sicurezza';
                      const isServizio = c.categoria === 'servizio';

                      return (
                        <div 
                          key={c.id} 
                          className={`p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition hover:bg-slate-50/80 ${
                            isSicurezza ? 'bg-amber-50/40' : ''
                          }`}
                        >
                          {/* Dettaglio Ufficio e Nominativo */}
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black shrink-0 mt-0.5 ${
                              isSicurezza 
                                ? 'bg-amber-100 text-amber-800' 
                                : isServizio 
                                  ? 'bg-blue-100 text-blue-800' 
                                  : 'bg-slate-100 text-slate-700'
                            }`}>
                              {isSicurezza ? (
                                c.ufficio.includes('Antincendio') ? <Flame className="w-4 h-4 text-orange-600" /> : <HeartPulse className="w-4 h-4 text-red-600" />
                              ) : isServizio && c.ufficio.includes('Conference') ? (
                                <KeyRound className="w-4 h-4 text-indigo-600" />
                              ) : (
                                <Phone className="w-4 h-4 text-slate-600" />
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              {isEditing ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-1">
                                  <input
                                    type="text"
                                    placeholder="Ufficio / Reparto"
                                    value={c.ufficio}
                                    onChange={e => handleUpdateContact(sez.id, c.id, 'ufficio', e.target.value)}
                                    className="p-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-400"
                                  />
                                  <input
                                    type="text"
                                    placeholder="Nominativo (Cognome e Nome)"
                                    value={c.nominativo}
                                    onChange={e => handleUpdateContact(sez.id, c.id, 'nominativo', e.target.value)}
                                    className="p-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-400"
                                  />
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-extrabold text-xs sm:text-sm text-slate-900">
                                      {c.ufficio}
                                    </span>
                                    {c.note && (
                                      <span className="bg-amber-100 text-amber-900 border border-amber-200 text-[10px] font-black px-2 py-0.5 rounded-md flex items-center gap-1">
                                        🔑 {c.note}
                                      </span>
                                    )}
                                    {isSicurezza && (
                                      <span className="bg-red-100 text-red-800 text-[9.5px] font-black px-2 py-0.2 rounded-md uppercase tracking-wider">
                                        Sicurezza
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-slate-600 font-semibold mt-0.5 truncate">
                                    {c.nominativo}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Numero Interno & Azioni Dev */}
                          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                            {isEditing ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  placeholder="Interno"
                                  value={c.numero}
                                  onChange={e => handleUpdateContact(sez.id, c.id, 'numero', e.target.value)}
                                  className="w-28 p-1.5 bg-white border border-slate-300 rounded-lg text-xs font-black text-blue-700 text-center outline-none focus:ring-2 focus:ring-blue-400"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleDeleteContact(sez.id, c.id)}
                                  className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition cursor-pointer"
                                  title="Elimina voce"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="bg-blue-50 border border-blue-200/80 px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 shadow-2xs">
                                <span className="text-[10px] font-extrabold text-blue-600 uppercase tracking-wider">Int.</span>
                                <span className="font-black text-sm sm:text-base text-blue-900 tracking-wide">
                                  {c.numero}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* FOOTER MODALE */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 font-medium shrink-0">
          <span>Ingegno P&C S.r.l. · Elenco Ufficiale Interni</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-extrabold rounded-xl transition cursor-pointer"
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
