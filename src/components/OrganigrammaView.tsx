import React, { useState, useMemo } from 'react';
import { useAuth, isTechnicalUser, type Dipendente } from '../contexts/AuthContext';
import { isCollaboratore } from '../pages/Impostazioni';
import { 
  Users, 
  Crown, 
  UserCheck,
  Compass,
  FileSpreadsheet,
  HardHat,
  ShieldCheck,
  Building2,
  Printer,
  X
} from 'lucide-react';
import { APP_VERSION, getPrintDateString } from '../config/version';

const areNamesEqual = (n1?: string | null, n2?: string | null): boolean => {
  if (!n1 || !n2) return false;
  const clean1 = n1.toLowerCase().trim().replace(/\s+/g, ' ');
  const clean2 = n2.toLowerCase().trim().replace(/\s+/g, ' ');
  if (clean1 === clean2) return true;
  const w1 = clean1.split(' ').sort().join(' ');
  const w2 = clean2.split(' ').sort().join(' ');
  return w1 === w2;
};

const MACRO_AREA_ICONS: Record<string, React.ReactNode> = {
  'Disegnatori': <FileSpreadsheet className="w-4 h-4 text-teal-600 shrink-0" />,
  'Ingegneria': <Compass className="w-4 h-4 text-indigo-600 shrink-0" />,
  'Sicurezza Cantieri': <HardHat className="w-4 h-4 text-emerald-600 shrink-0" />,
  'Consulenza Sicurezza': <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />,
  'Amministrazione': <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
};

export const OrganigrammaView: React.FC = () => {
  const { dipendenti = [], coordinatori = [], userEmail, myAssociatedName } = useAuth();

  // Stati Modal di Stampa e Filtri
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printTipoFilter, setPrintTipoFilter] = useState<'tutti' | 'dipendenti' | 'collaboratori'>('tutti');
  const [printAreaFilter, setPrintAreaFilter] = useState<string>('tutte');

  // Helper per verificare se un dipendente è l'utente attualmente collegato
  const isCurrentUser = (nome?: string, email?: string) => {
    if (email && userEmail && email.toLowerCase().trim() === userEmail.toLowerCase().trim()) return true;
    if (nome && myAssociatedName && areNamesEqual(nome, myAssociatedName)) return true;
    return false;
  };

  // Dipendenti attivi (non cessati)
  const activeDipendenti = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return dipendenti.filter(d => (!d.dataCessazione || d.dataCessazione >= todayStr) && !isTechnicalUser(d));
  }, [dipendenti]);

  // Membri della Direzione (Soci / Direzione Generali)
  const direzioneMembers = useMemo(() => {
    return activeDipendenti.filter(dip => {
      const cleanName = dip.nome.toLowerCase().trim();
      return cleanName === 'corbellini matteo' || cleanName === 'profeti andrea' || cleanName === 'matteo corbellini' || cleanName === 'andrea profeti';
    });
  }, [activeDipendenti]);

  // Coordinatori mappati con nome ed email per ciascuna area
  const coordinatorsByArea = useMemo(() => {
    const map: Record<string, { nome: string; email: string }[]> = {};

    coordinatori.forEach(coord => {
      if (!coord.area) return;
      const areaKey = coord.area.trim();
      if (!map[areaKey]) map[areaKey] = [];

      const matchedDip = activeDipendenti.find(d => d.email?.toLowerCase().trim() === coord.email?.toLowerCase().trim());
      const nome = matchedDip ? matchedDip.nome : (coord.email.toLowerCase().includes('mcorbellini') ? 'Corbellini Matteo' : coord.email);

      if (!map[areaKey].some(c => c.email.toLowerCase() === coord.email.toLowerCase())) {
        map[areaKey].push({ nome, email: coord.email });
      }
    });

    if (!map['Amministrazione']) map['Amministrazione'] = [];
    if (!map['Amministrazione'].some(c => c.email.toLowerCase().includes('mcorbellini'))) {
      map['Amministrazione'].push({
        nome: 'Corbellini Matteo',
        email: 'mcorbellini@ingegno06.it'
      });
    }

    return map;
  }, [coordinatori, activeDipendenti]);

  // Aree standard in ordine fisso
  const MACRO_AREE_ORDINE = [
    'Disegnatori',
    'Ingegneria',
    'Sicurezza Cantieri',
    'Consulenza Sicurezza',
    'Amministrazione'
  ];

  // Raggruppamento dei dipendenti per ciascuna Macro Area (escludendo i Soci)
  const groupedDipendenti = useMemo(() => {
    const map: Record<string, Dipendente[]> = {};

    MACRO_AREE_ORDINE.forEach(area => { map[area] = []; });

    activeDipendenti.forEach(dip => {
      const cleanName = dip.nome.toLowerCase().trim();
      const isSocio = cleanName === 'corbellini matteo' || cleanName === 'profeti andrea' || cleanName === 'matteo corbellini' || cleanName === 'andrea profeti';
      if (isSocio) return;

      const areaName = dip.macroArea || 'Altro';
      if (!map[areaName]) map[areaName] = [];
      map[areaName].push(dip);
    });

    Object.keys(map).forEach(area => {
      map[area].sort((a, b) => a.nome.localeCompare(b.nome));
    });

    return map;
  }, [activeDipendenti]);

  // Calcolo Risorse Filtrate per la Stampa
  const filteredPrintResources = useMemo(() => {
    const list: Array<{
      id: string;
      nome: string;
      email: string;
      tipoFormatted: string;
      tipoRaw: 'socio' | 'dipendente' | 'collaboratore';
      macroArea: string;
    }> = [];

    // 1. Soci / Direzione
    direzioneMembers.forEach(m => {
      list.push({
        id: m.id,
        nome: m.nome,
        email: m.email || '',
        tipoFormatted: 'Socio / Direzione',
        tipoRaw: 'socio',
        macroArea: 'Direzione Aziendale'
      });
    });

    // 2. Altri Dipendenti e Collaboratori (usando isCollaboratore per conteggio esatto di tutti i 14 collaboratori)
    activeDipendenti.forEach(dip => {
      const cleanName = dip.nome.toLowerCase().trim();
      const isSocio = cleanName === 'corbellini matteo' || cleanName === 'profeti andrea' || cleanName === 'matteo corbellini' || cleanName === 'andrea profeti';
      if (isSocio) return;

      const isCollab = isCollaboratore(dip.nome, dip.tipo);
      const areaName = dip.macroArea || 'Altro';

      list.push({
        id: dip.id,
        nome: dip.nome,
        email: dip.email || '',
        tipoFormatted: isCollab ? 'Collaboratore' : 'Dipendente',
        tipoRaw: isCollab ? 'collaboratore' : 'dipendente',
        macroArea: areaName
      });
    });

    const getSortKey = (name: string) => {
      if (!name) return '';
      const clean = name.trim().replace(/\s+/g, ' ');
      const lower = clean.toLowerCase();
      if (lower === 'matteo corbellini') return 'Corbellini Matteo';
      if (lower === 'andrea profeti') return 'Profeti Andrea';
      return clean;
    };

    return list.filter(item => {
      if (printTipoFilter === 'dipendenti' && item.tipoRaw !== 'dipendente') return false;
      if (printTipoFilter === 'collaboratori' && item.tipoRaw !== 'collaboratore') return false;
      if (printAreaFilter !== 'tutte' && item.macroArea !== printAreaFilter) return false;
      return true;
    }).sort((a, b) => {
      return getSortKey(a.nome).localeCompare(getSortKey(b.nome), 'it', { sensitivity: 'base' });
    });
  }, [direzioneMembers, activeDipendenti, printTipoFilter, printAreaFilter]);

  // Generatore di Stampa HTML Pulito ed Elegante
  const handlePrintList = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert("Impossibile aprire la finestra di stampa. Assicurati che i pop-up siano abilitati per questo sito.");
      return;
    }

    const printDate = getPrintDateString();
    const logoUrl = `${window.location.origin}/Logo.png`;

    const tipoLabel = printTipoFilter === 'tutti' ? 'Tutti (Soci, Dipendenti, Collaboratori)' : (printTipoFilter === 'dipendenti' ? 'Solo Dipendenti' : 'Solo Collaboratori');
    const areaLabel = printAreaFilter === 'tutte' ? 'Tutte le Macroaree' : printAreaFilter;

    const rowsHtml = filteredPrintResources.map((res, index) => `
      <tr>
        <td style="text-align: center; font-weight: bold; color: #475569; width: 40px; font-size: 10.5px;">${index + 1}</td>
        <td style="font-weight: 700; color: #0f172a; font-size: 11px;">${res.nome}</td>
        <td style="font-weight: 600; color: #334155; font-size: 10.5px;">${res.macroArea}</td>
        <td style="text-align: center; font-weight: 700; color: #1e293b; font-size: 10.5px;">${res.tipoFormatted}</td>
        <td style="font-size: 10px; color: #475569; font-family: monospace;">${res.email || '-'}</td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="it">
      <head>
        <meta charset="UTF-8">
        <title>Elenco Risorse Umane - INGEGNO P&C S.R.L.</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
          * {
            box-sizing: border-box !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            font-size: 9.5px;
            color: #0f172a;
          }
          
          table.main-layout { width: 100%; border-collapse: collapse; border: none; }
          table.main-layout > thead > tr > td { padding: 0; border: none; }
          table.main-layout > tbody > tr > td { padding: 0; border: none; }
          table.main-layout > tfoot > tr > td { padding: 0; border: none; }

          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 8px;
            margin-bottom: 8px;
          }
          .logo {
            height: 38px;
            object-fit: contain;
          }
          .title-container {
            text-align: right;
          }
          .company-name {
            font-size: 12px;
            font-weight: 900;
            color: #0f172a;
            letter-spacing: 0.05em;
            text-transform: uppercase;
          }
          .doc-title {
            font-size: 15px;
            font-weight: 900;
            color: #2563eb;
            margin-top: 2px;
            text-transform: uppercase;
          }
          .filter-info {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 6px 10px;
            margin-bottom: 10px;
            font-size: 9px;
            color: #475569;
            font-weight: 600;
          }
          .filter-pill {
            font-weight: 800;
            color: #1e293b;
          }

          table.report-table {
            width: 100% !important;
            border-collapse: collapse !important;
            border: 1.5px solid #0f172a !important;
            font-size: 9.5px !important;
          }
          table.report-table th {
            background-color: #1e293b !important;
            color: #ffffff !important;
            font-size: 9px !important;
            font-weight: 800 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.05em !important;
            padding: 6px 8px !important;
            border: 1px solid #0f172a !important;
          }
          table.report-table td {
            padding: 5.5px 8px !important;
            border: 1px solid #cbd5e1 !important;
            vertical-align: middle !important;
          }
          table.report-table tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          table.report-table tr:nth-child(even) td {
            background-color: #f8fafc !important;
          }

          .footer-static {
            margin-top: 10px;
            padding-top: 6px;
            padding-bottom: 4px;
            border-top: 1px solid #cbd5e1;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 8.5px;
            font-weight: 600;
            color: #64748b;
            font-family: monospace;
          }
        </style>
      </head>
      <body>
        <table class="main-layout">
          <thead>
            <tr>
              <td>
                <div class="header">
                  <img src="${logoUrl}" alt="INGEGNO Logo" class="logo" />
                  <div class="title-container">
                    <div class="company-name">INGEGNO P&C S.R.L.</div>
                    <div class="doc-title">Elenco Risorse Umane</div>
                  </div>
                </div>
                <div class="filter-info">
                  <div>
                    <span>Filtro Inquadramento: </span><span class="filter-pill">${tipoLabel}</span>
                    <span style="margin: 0 8px; color: #cbd5e1;">|</span>
                    <span>Macroarea: </span><span class="filter-pill">${areaLabel}</span>
                  </div>
                  <div>Totale Risorse Stampate: <strong style="color: #0f172a; font-size: 10px;">${filteredPrintResources.length}</strong></div>
                </div>
              </td>
            </tr>
          </thead>
          <tfoot>
            <tr>
              <td>
                <div class="footer-static">
                  <span>INGEGNO P&C S.R.L. · Documento Ufficiale Risorse Umane</span>
                  <span>${APP_VERSION} — Data Stampa: ${printDate}</span>
                </div>
              </td>
            </tr>
          </tfoot>
          <tbody>
            <tr>
              <td>
                <table class="report-table">
                  <thead>
                    <tr>
                      <th style="width: 35px; text-align: center;">#</th>
                      <th style="text-align: left;">Cognome e Nome</th>
                      <th style="text-align: left;">Macroarea</th>
                      <th style="text-align: center; width: 120px;">Inquadramento</th>
                      <th style="text-align: left;">E-mail Aziendale</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rowsHtml}
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
              window.close();
            }, 300);
          };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in pb-10">
      
      {/* 1. SEZIONE DIREZIONE (IN ALTO SOPRA TUTTO) */}
      <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-white rounded-3xl p-5 sm:p-6 shadow-md border border-amber-400/30 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-white/20 backdrop-blur-md rounded-2xl text-white shadow-xs">
            <Crown className="w-6 h-6 fill-amber-200 text-amber-100" />
          </div>
          <div>
            <h3 className="text-lg font-black tracking-wider uppercase flex items-center gap-2">
              DIREZIONE AZIENDALE
            </h3>
            <p className="text-xs text-amber-100 font-medium">Soci di Riferimento e Direzione Generale</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {direzioneMembers.map(member => {
            const isMe = isCurrentUser(member.nome, member.email);
            return (
              <div 
                key={member.id}
                className={`flex items-center gap-2.5 px-4.5 py-2.5 rounded-2xl text-xs font-black shadow-xs transition-all ${
                  isMe 
                    ? 'bg-indigo-600 text-white ring-4 ring-indigo-300 shadow-lg scale-105' 
                    : 'bg-white/95 text-amber-950 hover:bg-white'
                }`}
              >
                <span className="font-extrabold text-sm tracking-tight">{member.nome}</span>

                {isMe && (
                  <span className="bg-white text-indigo-900 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider shadow-xs ml-1 flex items-center gap-1">
                    <UserCheck className="w-3 h-3 text-indigo-600" /> TU
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. SCHEMA COMPATTO A 5 COLONNE PER TUTTE LE MACROAREE */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] p-4 sm:p-6 border border-white/60 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 pb-2 border-b border-gray-150 gap-2">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base font-black text-gray-900 uppercase tracking-wide">
              Composizione Macro Aree e Team
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-gray-500">
              {activeDipendenti.length} Risorse Totali
            </span>
            <button
              type="button"
              onClick={() => setIsPrintModalOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold px-3.5 py-1.5 rounded-xl shadow-xs transition flex items-center gap-1.5 text-xs cursor-pointer active:scale-95"
            >
              <Printer className="w-4 h-4" /> Stampa Elenco Risorse
            </button>
          </div>
        </div>

        {/* GRIGLIA COMPATTA 5 COLONNE AFFIANCATE */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {MACRO_AREE_ORDINE.map(areaName => {
            const members = groupedDipendenti[areaName] || [];
            const areaCoords = coordinatorsByArea[areaName] || [];
            const icon = MACRO_AREA_ICONS[areaName] || <Building2 className="w-4 h-4 text-gray-600 shrink-0" />;

            const nonCoordMembers = members.filter(m => 
              !areaCoords.some(c => c.email.toLowerCase().trim() === m.email?.toLowerCase().trim() || areNamesEqual(c.nome, m.nome))
            );

            const isUserCategory = areaCoords.some(c => isCurrentUser(c.nome, c.email)) ||
                                   members.some(m => isCurrentUser(m.nome, m.email));

            return (
              <div 
                key={areaName}
                className={`rounded-2xl p-3.5 flex flex-col justify-between h-full transition-all ${
                  isUserCategory
                    ? 'bg-indigo-50/60 border-2 border-indigo-500 shadow-md ring-4 ring-indigo-100/80'
                    : 'bg-slate-50/70 border border-slate-200/80 shadow-2xs hover:shadow-xs'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between pb-2.5 border-b border-slate-200 mb-3 gap-2 min-h-[46px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="p-1.5 bg-white rounded-lg border border-slate-100 shadow-2xs shrink-0">
                        {icon}
                      </div>
                      <h4 className="text-[11px] font-black uppercase text-slate-800 tracking-tight leading-tight">
                        {areaName}
                      </h4>
                    </div>

                    <span className="bg-slate-200 text-slate-800 text-[11px] font-black px-2 py-0.5 rounded-full shrink-0">
                      {members.length}
                    </span>
                  </div>

                  <div className="mb-3">
                    <div className="text-[10px] uppercase font-black text-emerald-800 tracking-wider mb-1.5">
                      <span>COORDINATORI ({areaCoords.length})</span>
                    </div>

                    {areaCoords.length > 0 ? (
                      <div className="space-y-1.5">
                        {areaCoords.map(coord => {
                          const isMe = isCurrentUser(coord.nome, coord.email);
                          return (
                            <div 
                              key={coord.email}
                              className={`p-2.5 rounded-xl text-xs font-bold border transition-all ${
                                isMe 
                                  ? 'bg-indigo-600 text-white border-indigo-700 shadow-md ring-2 ring-indigo-300 font-extrabold'
                                  : 'bg-emerald-50/90 border-emerald-200 text-emerald-950 shadow-2xs'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="truncate font-black">{coord.nome}</span>
                                {isMe && (
                                  <span className="bg-white text-indigo-900 text-[9px] font-black px-1.5 py-0.5 rounded-full shrink-0 shadow-2xs">
                                    TU
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-2 rounded-xl bg-white/60 border border-dashed border-slate-250 text-center text-[10px] text-slate-400 italic">
                        Nessun coordinatore
                      </div>
                    )}
                  </div>

                  <hr className="border-slate-200 my-2.5" />

                  <div className="space-y-1.5">
                    {nonCoordMembers.length === 0 ? (
                      <div className="text-[10.5px] text-slate-400 italic text-center p-2">
                        Nessuna risorsa aggiuntiva
                      </div>
                    ) : (
                      nonCoordMembers.map(member => {
                        const isMe = isCurrentUser(member.nome, member.email);

                        return (
                          <div
                            key={member.id}
                            className={`p-2 px-2.5 rounded-xl border text-xs font-bold flex items-center justify-between transition-all ${
                              isMe
                                ? 'bg-indigo-600 text-white border-indigo-700 shadow-md font-black ring-2 ring-indigo-300 scale-[1.02]'
                                : 'bg-white hover:bg-indigo-50/40 border-slate-200/90 text-slate-800 shadow-2xs'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="truncate" title={member.nome}>{member.nome}</span>
                            </div>

                            {isMe && (
                              <span className="bg-white text-indigo-900 text-[9px] font-black px-1.5 py-0.5 rounded-full shrink-0 shadow-2xs">
                                TU
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MODALE PER FILTRO E STAMPA ELENCO RISORSE */}
      {isPrintModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-6">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 leading-tight">
                    Stampa Elenco Risorse
                  </h3>
                  <p className="text-xs text-slate-500">Filtra e genera il documento ufficiale di stampa dell'organigramma</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPrintModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                  Tipologia Risorse (Inquadramento)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'tutti', label: 'Tutti (incl. Soci)' },
                    { id: 'dipendenti', label: 'Solo Dipendenti' },
                    { id: 'collaboratori', label: 'Solo Collaboratori' },
                  ].map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setPrintTipoFilter(item.id as any)}
                      className={`py-2.5 px-2 rounded-xl border text-xs font-bold transition flex items-center justify-center text-center cursor-pointer ${
                        printTipoFilter === item.id
                          ? 'bg-indigo-600 text-white border-indigo-700 shadow-xs font-black'
                          : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-2">
                  Macroarea di Appartenenza
                </label>
                <select
                  value={printAreaFilter}
                  onChange={e => setPrintAreaFilter(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 shadow-xs"
                >
                  <option value="tutte">── Tutte le Macroaree ──</option>
                  <option value="Direzione Aziendale">Direzione Aziendale (Soci)</option>
                  <option value="Disegnatori">Disegnatori</option>
                  <option value="Ingegneria">Ingegneria</option>
                  <option value="Sicurezza Cantieri">Sicurezza Cantieri</option>
                  <option value="Consulenza Sicurezza">Consulenza Sicurezza</option>
                  <option value="Amministrazione">Amministrazione</option>
                </select>
              </div>

              <div className="bg-indigo-50/70 border border-indigo-150 p-3.5 rounded-2xl flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-extrabold text-indigo-950">
                  <Users className="w-4 h-4 text-indigo-600" /> Risorse Selezionate per la Stampa:
                </div>
                <span className="bg-indigo-600 text-white font-black text-xs px-2.5 py-1 rounded-full shadow-xs">
                  {filteredPrintResources.length}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsPrintModalOpen(false)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsPrintModalOpen(false);
                  handlePrintList();
                }}
                disabled={filteredPrintResources.length === 0}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow-md transition flex items-center gap-2 cursor-pointer disabled:opacity-50 active:scale-95"
              >
                <Printer className="w-4 h-4" /> Genera e Stampa Documento
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
