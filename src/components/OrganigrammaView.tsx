import React, { useMemo } from 'react';
import { useAuth, isTechnicalUser, type Dipendente } from '../contexts/AuthContext';
import { 
  Users, 
  Crown, 
  UserCheck,
  Compass,
  FileSpreadsheet,
  HardHat,
  ShieldCheck,
  Building2
} from 'lucide-react';

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

  // Coordinatori mappati con nome ed email per ciascuna area (incluso Corbellini Matteo per Amministrazione)
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

    // Assicura che Corbellini Matteo sia presente nei coordinatori di Amministrazione
    if (!map['Amministrazione']) map['Amministrazione'] = [];
    if (!map['Amministrazione'].some(c => c.email.toLowerCase().includes('mcorbellini'))) {
      map['Amministrazione'].push({
        nome: 'Corbellini Matteo',
        email: 'mcorbellini@ingegno06.it'
      });
    }

    return map;
  }, [coordinatori, activeDipendenti]);

  // Aree standard in ordine fisso come richiesto (escludendo la Direzione che va in alto)
  const MACRO_AREE_ORDINE = [
    'Disegnatori',
    'Ingegneria',
    'Sicurezza Cantieri',
    'Consulenza Sicurezza',
    'Amministrazione'
  ];

  // Raggruppamento dei dipendenti per ciascuna Macro Area (escludendo i Soci che vanno in Direzione)
  const groupedDipendenti = useMemo(() => {
    const map: Record<string, Dipendente[]> = {};

    MACRO_AREE_ORDINE.forEach(area => { map[area] = []; });

    activeDipendenti.forEach(dip => {
      const cleanName = dip.nome.toLowerCase().trim();
      const isSocio = cleanName === 'corbellini matteo' || cleanName === 'profeti andrea' || cleanName === 'matteo corbellini' || cleanName === 'andrea profeti';
      if (isSocio) return; // già in Direzione in alto

      const areaName = dip.macroArea || 'Altro';
      if (!map[areaName]) map[areaName] = [];
      map[areaName].push(dip);
    });

    // Ordina i membri in ciascuna area in ordine alfabetico
    Object.keys(map).forEach(area => {
      map[area].sort((a, b) => a.nome.localeCompare(b.nome));
    });

    return map;
  }, [activeDipendenti]);

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
                className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl text-xs font-black shadow-xs transition-all ${
                  isMe 
                    ? 'bg-indigo-600 text-white ring-4 ring-indigo-300 shadow-lg scale-105' 
                    : 'bg-white/95 text-amber-950 hover:bg-white'
                }`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-xs ${
                  isMe ? 'bg-white text-indigo-900' : 'bg-amber-600 text-white'
                }`}>
                  {member.nome.charAt(0).toUpperCase()}
                </div>
                <span className="font-extrabold text-sm">{member.nome}</span>

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
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-150">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base font-black text-gray-900 uppercase tracking-wide">
              Composizione Macro Aree e Team
            </h3>
          </div>
          <span className="text-xs font-bold text-gray-500">
            {activeDipendenti.length} Risorse Totali
          </span>
        </div>

        {/* GRIGLIA COMPATTA 5 COLONNE AFFIANCATE */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {MACRO_AREE_ORDINE.map(areaName => {
            const members = groupedDipendenti[areaName] || [];
            const areaCoords = coordinatorsByArea[areaName] || [];
            const icon = MACRO_AREA_ICONS[areaName] || <Building2 className="w-4 h-4 text-gray-600 shrink-0" />;

            // Se uno è già tra i coordinatori, non mostrare di nuovo nella lista dipendenti in basso
            const nonCoordMembers = members.filter(m => 
              !areaCoords.some(c => c.email.toLowerCase().trim() === m.email?.toLowerCase().trim() || areNamesEqual(c.nome, m.nome))
            );

            // Verifica se l'utente corrente appartiene a questa categoria/area (come coordinatore o come membro)
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
                  {/* INTESTAZIONE COLONNA CON ALTEZZA MINIMA UNIFORME */}
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

                  {/* SEZIONE COORDINATORI DELL'AREA */}
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

                  {/* ELENCO MEMBRI DEL TEAM (SOLO CHI NON È GIÀ COORDINATORE) */}
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

    </div>
  );
};
