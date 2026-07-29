import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, doc, setDoc, getDocs, query, where, addDoc, updateDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { FileText, Printer, Save, Send, CheckCircle, AlertCircle, Edit, Edit3, Trash2, MessageSquare, Clock, MapPin, Check, X, ShieldAlert, Download, RefreshCw, Plus } from 'lucide-react';
import { queueMail } from '../utils/mailSender';
import ConfirmModal from '../components/ConfirmModal';
import { isItalianHoliday, isWeekend as isWeekendGlobal } from '../utils/date';

export { isItalianHoliday };

const COLLABORATORI = [
  'Atanasio Daniele',
  'Biagioni Matteo',
  'Cappelli Marco',
  'Mancini Marco',
  'Marchetti Davide',
  'Menichetti Giulia',
  'Menichetti Lorenzo',
  'Panchetti Paolo',
  'Puliti Alessio',
  'Rossi Niccolò',
  'Russo Marco',
  'Signorini Leonardo',
  'Stefanelli Luca',
  'Votino Federica'
];

export function isCollaboratore(nome?: string | null, dipendentiList?: any[]): boolean {
  if (!nome) return false;
  const clean = nome.trim().toLowerCase();
  if (dipendentiList && Array.isArray(dipendentiList)) {
    const found = dipendentiList.find(d => d.nome.trim().toLowerCase() === clean);
    if (found?.tipo === 'collaboratore') return true;
    if (found?.tipo === 'dipendente') return false;
  }
  return COLLABORATORI.some(c => c.toLowerCase() === clean);
}

export function isInChiusuraAziendale(_dateStr: string): boolean {
  return false;
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

export interface Tratta {
  partenza: string;
  arrivo: string;
}

interface GiornoPresenza {
  ore: number;
  straordinari: number;
  ferie: number;
  permessi: number;
  malattia: boolean;
  trasferta: boolean;
  rimborsoKm?: boolean; // NEW: row K in presenze grid
  luogoTrasferta?: string;
  noteGiorno?: string;
  itinerarioTrasferta?: string;
  tratte?: Tratta[];
  kmTrasferta?: number;
  marcaAutomezzo?: string; // NEW: vehicle info per trip/day
  modelloAutomezzo?: string; // NEW: vehicle info per trip/day
  oreContratto?: number;
  permessoStudio?: number;
  permessoDonazione?: number;
  permessoElettorale?: number;
}

interface RapportinoPresenze {
  id: string; // {dipendenteNome}-{anno}-{mese}
  dipendenteNome: string;
  dipendenteEmail: string;
  mese: number;
  anno: number;
  stato: 'Bozza' | 'Inviato' | 'Approvato' | 'Richiede Modifica';
  noteDipendente: string;
  comunicazioniHR?: string;
  noteHR: string;
  hrModified?: boolean;
  submittedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  timestamp?: string;
  giorni: { [giorno: string]: GiornoPresenza };
  collaboratoreData?: {
    giornate: number;
    dailyRate: number;
    spese: number;
    km: number;
    kmRate: number;
    inpsRate: number;
    ivaRate: number;
    raRate: number;
    compensoMensile: number;
    rimborsoKm: number;
    totaleCompenso: number;
    inps: number;
    iva: number;
    ra: number;
    totaleDovuto: number;
    cassaLabel?: string;
    giornateOverride?: number;
    importoFissoMensile?: number;
  };
  rimborsoSpeseData?: { // NEW
    marcaAutomezzo: string;
    modelloAutomezzo: string;
    speseViaggio: number;
    speseTaxiBus: number;
    speseParcheggi: number;
    speseVitto: number;
    speseAlloggio: number;
    spesePedaggi: number;
    speseAltro: number;
    altroSpecificare: string;
  };
}

export function calculateDynamicGiornate(
  giorni: { [giorno: string]: GiornoPresenza },
  month: number,
  year: number,
  defaultContractHours: number = 8
): number {
  const daysInM = new Date(year, month, 0).getDate();
  let workingDays = 0;
  let leavesDays = 0;

  for (let d = 1; d <= daysInM; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(year, month - 1, d).getDay();
    const isWk = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = isItalianHoliday(dateStr);

    if (!isWk && !isHoliday) {
      workingDays++;
      const g = giorni[String(d)];
      if (g) {
        const contractHours = g.oreContratto || defaultContractHours || 8;
        const absenceHours =
          (g.ferie || 0) +
          (g.permessi || 0) +
          (g.permessoStudio || 0) +
          (g.permessoDonazione || 0) +
          (g.permessoElettorale || 0);

        if (g.malattia) {
          leavesDays += 1;
        } else {
          leavesDays += Math.min(1, absenceHours / contractHours);
        }
      }
    }
  }

  return Math.round((Math.max(0, workingDays - leavesDays)) * 100) / 100;
}

export function recalculateCollabData(
  giorni: { [giorno: string]: GiornoPresenza },
  month: number,
  year: number,
  collabData: NonNullable<RapportinoPresenze['collaboratoreData']>,
  defaultContractHours: number = 8
): NonNullable<RapportinoPresenze['collaboratoreData']> {
  const giornate = (collabData.giornateOverride !== undefined && collabData.giornateOverride !== null && Number(collabData.giornateOverride) >= 0)
    ? Number(collabData.giornateOverride)
    : calculateDynamicGiornate(giorni, month, year, defaultContractHours);

  const compensoMensile = (collabData.importoFissoMensile && Number(collabData.importoFissoMensile) > 0)
    ? Number(collabData.importoFissoMensile)
    : giornate * (collabData.dailyRate || 0);

  const rimborsoKm = (collabData.km || 0) * (collabData.kmRate || 0);
  const totaleCompenso = compensoMensile + (collabData.spese || 0) + rimborsoKm;
  const inps = (compensoMensile + rimborsoKm) * ((collabData.inpsRate || 0) / 100);
  const iva = (compensoMensile + rimborsoKm + inps) * ((collabData.ivaRate || 0) / 100);
  const ra = (compensoMensile + rimborsoKm) * ((collabData.raRate || 0) / 100);
  const totaleDovuto = totaleCompenso + inps + iva - ra;

  return {
    ...collabData,
    giornate,
    compensoMensile,
    rimborsoKm,
    totaleCompenso,
    inps,
    iva,
    ra,
    totaleDovuto
  };
}

export function isFullDayAbsence(giorno?: GiornoPresenza, defaultContractHours: number = 8): boolean {
  if (!giorno) return false;
  const contract = giorno.oreContratto ?? defaultContractHours;
  if (giorno.malattia) return true;
  if ((giorno.ferie || 0) >= contract) return true;
  if ((giorno.permessi || 0) >= contract) return true;
  if ((giorno.permessoStudio || 0) >= contract) return true;
  if ((giorno.permessoDonazione || 0) >= contract) return true;
  if ((giorno.permessoElettorale || 0) >= contract) return true;
  return false;
}

export function getTratteForGiorno(giorno?: GiornoPresenza): Tratta[] {
  if (giorno?.tratte && Array.isArray(giorno.tratte) && giorno.tratte.length > 0) {
    return giorno.tratte;
  }
  if (giorno?.itinerarioTrasferta || giorno?.luogoTrasferta) {
    const text = (giorno.itinerarioTrasferta || giorno.luogoTrasferta || '').trim();
    if (text.includes(' -> ')) {
      const parts = text.split(' -> ');
      return [{ partenza: parts[0].trim(), arrivo: parts.slice(1).join(' -> ').trim() }];
    }
    if (text.includes(' - ')) {
      const parts = text.split(' - ');
      return [{ partenza: parts[0].trim(), arrivo: parts.slice(1).join(' - ').trim() }];
    }
    return [{ partenza: '', arrivo: text }];
  }
  return [{ partenza: '', arrivo: '' }];
}

const MESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

export default function Presenze() {
  const { user, isAdmin, isHR, myAssociatedName, dipendenti, refreshData, userEmail } = useAuth();

  const isSocio = useMemo(() => {
    const email = userEmail?.trim().toLowerCase();
    return email === 'aprofeti@ingegno06.it' || email === 'mcorbellini@ingegno06.it';
  }, [userEmail]);

  const filteredDipendenti = useMemo(() => {
    return dipendenti.filter(d => {
      const email = d.email?.trim().toLowerCase();
      return email !== 'aprofeti@ingegno06.it' && email !== 'mcorbellini@ingegno06.it' && email !== 'synergiesflow@ingegno06.it';
    });
  }, [dipendenti]);

  const profile = useMemo(() => {
    if (!myAssociatedName) return null;
    return dipendenti.find(d => d.nome.trim().toLowerCase() === myAssociatedName.trim().toLowerCase()) || null;
  }, [myAssociatedName, dipendenti]);

  const contractHours = profile?.oreContratto ?? 8;

  // queueEmailNotification rimossa a favore di queueMail centralizzata
  
  // Date Selection
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1); // 1-12
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  
  // Mode Selection: 'compila' (employee mode) or 'hr' (admin/hr dashboard)
  const [viewMode, setViewMode] = useState<'compila' | 'hr'>(() => {
    const email = userEmail?.trim().toLowerCase();
    const socio = email === 'aprofeti@ingegno06.it' || email === 'mcorbellini@ingegno06.it';
    return (isHR || isAdmin || socio) ? 'hr' : 'compila';
  });

  useEffect(() => {
    if (isSocio && viewMode !== 'hr') {
      setViewMode('hr');
    }
  }, [isSocio, viewMode]);

  // State for Employee Mode
  const [rapportino, setRapportino] = useState<RapportinoPresenze | null>(null);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [decorrenzaGiorno, setDecorrenzaGiorno] = useState<number>(1);
  const [localOrarioSettimanale, setLocalOrarioSettimanale] = useState<Record<string, number | ''>>({ lun: 8, mar: 8, mer: 8, gio: 8, ven: 8 });

  useEffect(() => {
    if (profile?.orarioSettimanale) {
      setLocalOrarioSettimanale(profile.orarioSettimanale);
    } else if (profile?.oreContratto !== undefined) {
      const h = profile.oreContratto;
      setLocalOrarioSettimanale({ lun: h, mar: h, mer: h, gio: h, ven: h });
    }
  }, [profile]);
  const [activeTab, setActiveTab] = useState<'ore' | 'weekend'>('ore');
  const [chiusureAziendali, setChiusureAziendali] = useState<Array<{ dataInizio: string; dataFine: string }>>([]);

  const isInChiusuraAziendaleLocal = (dateStr: string) => {
    return chiusureAziendali.some(c => dateStr >= c.dataInizio && dateStr <= c.dataFine);
  };

  // State for HR Mode
  const [allRapportini, setAllRapportini] = useState<Record<string, RapportinoPresenze>>({});
  const [loadingHR, setLoadingHR] = useState(false);
  const [hrTab, setHrTab] = useState<'dipendenti' | 'collaboratori'>('dipendenti');
  
  // HR review modal
  const [reviewingRapportino, setReviewingRapportino] = useState<RapportinoPresenze | null>(null);
  const [hrFeedbackNote, setHrFeedbackNote] = useState('');
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [exportingAnnual, setExportingAnnual] = useState(false);
  const [selectedDipFilter, setSelectedDipFilter] = useState('');
  const [printTargetSheet, setPrintTargetSheet] = useState<RapportinoPresenze | null>(null);

  // Stati per autorizzazione weekend/chiusure
  const [approvedWeekends, setApprovedWeekends] = useState<Record<string, boolean>>({});
  const [approvedLeaves, setApprovedLeaves] = useState<Record<string, { tipo: string; frazioneTipo?: string; oraInizio?: string; oraFine?: string; pausaPranzo?: boolean; pausaPranzoOre?: number }>>({});
  const [reqWeekendData, setReqWeekendData] = useState('');
  const [reqWeekendMotivo, setReqWeekendMotivo] = useState('');
  const [reqWeekendLoading, setReqWeekendLoading] = useState(false);
  const [myWeekendRequests, setMyWeekendRequests] = useState<any[]>([]);
  const [allWeekendRequests, setAllWeekendRequests] = useState<any[]>([]);
  const [directAuthDipNome, setDirectAuthDipNome] = useState('');
  const [directAuthData, setDirectAuthData] = useState('');
  const [directAuthMotivo, setDirectAuthMotivo] = useState('');
  const [directAuthLoading, setDirectAuthLoading] = useState(false);

  // Modifica / Annullamento richieste weekend dipendenti
  const [modifyingWeekendReq, setModifyingWeekendReq] = useState<any | null>(null);
  const [modWeekendTipo, setModWeekendTipo] = useState<'annullamento' | 'modifica'>('annullamento');
  const [modWeekendNuovaData, setModWeekendNuovaData] = useState('');
  const [modWeekendMotivo, setModWeekendMotivo] = useState('');
  const [modWeekendLoading, setModWeekendLoading] = useState(false);

  // Stati per badge notifica globali (solo per HR e non Admin)
  const [globalPendingInviatiCount, setGlobalPendingInviatiCount] = useState(0);
  const [globalPendingWeekendCount, setGlobalPendingWeekendCount] = useState(0);

  // Stato per la modale di conferma personalizzata
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
  });

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  const triggerConfirm = (title: string, message: string, onConfirm: () => void, type: 'danger' | 'warning' | 'info' = 'danger') => {
    setConfirmConfig({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      },
      type
    });
  };

  // Get days in selected month
  const daysInMonth = useMemo(() => {
    return new Date(selectedYear, selectedMonth, 0).getDate();
  }, [selectedMonth, selectedYear]);

  // Check if a day is weekend
  const isWeekend = (dayNum: number) => {
    return isWeekendGlobal(new Date(selectedYear, selectedMonth - 1, dayNum));
  };

  const getCellDayStyle = (dayNum: number) => {
    const outOfMonth = dayNum > daysInMonth;
    if (outOfMonth) return { className: "bg-gray-200/30 text-gray-400", style: {} };

    const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

    const currentEmpName = reviewingRapportino ? reviewingRapportino.dipendenteNome : myAssociatedName;
    const profile = currentEmpName ? dipendenti.find(d => d.nome.trim().toLowerCase() === currentEmpName.trim().toLowerCase()) : null;
    const isCessato = profile?.dataCessazione && dateStr > profile.dataCessazione;
    if (isCessato) {
      return {
        className: "text-white text-center font-bold bg-gray-500",
        style: { background: 'linear-gradient(135deg, #4b5563 0%, #374151 100%)' }
      };
    }

    const isWk = isWeekend(dayNum);
    const isHoliday = isItalianHoliday(dateStr);

    if (isWk || isHoliday) {
      if (approvedWeekends[dateStr]) {
        return {
          className: "text-emerald-950 font-black",
          style: { background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)' }
        };
      }
      return {
        className: "text-gray-500",
        style: { background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)' }
      };
    }
    return { className: "", style: {} };
  };

  const isCellDisabled = (dayNum: number, fieldType: 'lavoro' | 'assenza') => {
    if (dayNum > daysInMonth) return true;
    const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

    const currentEmpName = reviewingRapportino ? reviewingRapportino.dipendenteNome : myAssociatedName;
    const profile = currentEmpName ? dipendenti.find(d => d.nome.trim().toLowerCase() === currentEmpName.trim().toLowerCase()) : null;
    const isCessato = profile?.dataCessazione && dateStr > profile.dataCessazione;
    if (isCessato) return true;

    const isWk = isWeekend(dayNum);
    const isHoliday = isItalianHoliday(dateStr);
    const isSpecialDay = isWk || isHoliday; // weekend o festivo

    if (!isSpecialDay) {
      // Le chiusure aziendali rimangono editabili per tutti
      return false; 
    }

    // Per weekend e festivi
    if (fieldType === 'assenza') {
      return true; // Le assenze non sono mai selezionabili nei weekend/festivi
    }

    // Per il lavoro (ore ordinarie, straordinarie, trasferte) nei weekend/festivi:
    // sono disabilitate a meno che il weekend non sia stato autorizzato
    return !approvedWeekends[dateStr];
  };

  const isDayLockedForUser = (dNum: number) => {
    const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;

    const currentEmpName = reviewingRapportino ? reviewingRapportino.dipendenteNome : myAssociatedName;
    const profile = currentEmpName ? dipendenti.find(d => d.nome.trim().toLowerCase() === currentEmpName.trim().toLowerCase()) : null;
    const isCessato = profile?.dataCessazione && dateStr > profile.dataCessazione;
    if (isCessato) return true;

    if (approvedLeaves[dateStr]) {
      const abs = approvedLeaves[dateStr];
      // Blocca SOLO se è una assenza di giornata intera:
      // ferie, malattia, maternità oppure permesso esplicitamente per 'giornata'
      const isFullDay =
        abs.tipo === 'ferie' ||
        abs.tipo === 'malattia' ||
        abs.tipo === 'maternita' ||
        (abs.tipo === 'permesso' && abs.frazioneTipo === 'giornata');
      if (isFullDay) {
        return true;
      }
      // Permessi parziali (orario, mattina, pomeriggio, smart, ecc.) → non blocca
    }
    const isWk = isWeekend(dNum);
    const isChiusura = isInChiusuraAziendaleLocal(dateStr);
    const isHoliday = isItalianHoliday(dateStr);
    return (isWk || isChiusura || isHoliday) && !approvedWeekends[dateStr];
  };


  // Convert 1-31 number to padded string
  const dayStr = (d: number) => String(d);
  // --- PREFILL LOGIC ---
  const createPrefilledRapportino = async () => {
    if (!myAssociatedName || !userEmail) return;

    const profile = dipendenti.find(d => d.nome.trim().toLowerCase() === myAssociatedName.trim().toLowerCase());

    try {
      // 1. Fetch approved requests from 'richieste_ferie'
      const qRichieste = query(
        collection(db, 'richieste_ferie'),
        where('dipendenteName', '==', myAssociatedName),
        where('stato', '==', 'Approvato')
      );

      const querySnap = await getDocs(qRichieste);
      const approvedAbsences: Record<string, { tipo: string; frazioneTipo?: string; oraInizio?: string; oraFine?: string; pausaPranzo?: boolean; pausaPranzoOre?: number }> = {}; // YYYY-MM-DD -> data
      
      querySnap.forEach(docSnap => {
        const d = docSnap.data();
        const start = d.dataInizio || d.data;
        const end = d.dataFine || d.data;
        
        if (start && end) {
          const [startYear, startMonth, startDay] = start.split('-').map(Number);
          const [endYear, endMonth, endDay] = end.split('-').map(Number);
          
          const currDate = new Date(startYear, startMonth - 1, startDay);
          const lastDate = new Date(endYear, endMonth - 1, endDay);
          
          while (currDate <= lastDate) {
            const y = currDate.getFullYear();
            const m = String(currDate.getMonth() + 1).padStart(2, '0');
            const dStr = String(currDate.getDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${dStr}`;
            
            if (dateStr.startsWith(`${selectedYear}-${String(selectedMonth).padStart(2, '0')}`)) {
              approvedAbsences[dateStr] = {
                tipo: d.tipo,
                frazioneTipo: d.frazioneTipo,
                oraInizio: d.oraInizio,
                oraFine: d.oraFine,
                pausaPranzo: d.pausaPranzo || false,
                pausaPranzoOre: d.pausaPranzoOre || 0
              };
            }
            currDate.setDate(currDate.getDate() + 1);
          }
        }
      });

      // 2. Generate days 1-31
      const giorni: { [giorno: string]: GiornoPresenza } = {};
      const numDays = new Date(selectedYear, selectedMonth, 0).getDate();

      for (let day = 1; day <= 31; day++) {
        if (day > numDays) {
          giorni[String(day)] = {
            ore: 0,
            straordinari: 0,
            ferie: 0,
            permessi: 0,
            malattia: false,
            trasferta: false,
            permessoStudio: 0,
            permessoDonazione: 0,
            permessoElettorale: 0
          };
          continue;
        }
        const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dateObj = new Date(selectedYear, selectedMonth - 1, day);
        const dayOfWeek = dateObj.getDay();
        const isWknd = dayOfWeek === 0 || dayOfWeek === 6;
        const isHoliday = isItalianHoliday(dateStr);
        const isCessato = profile?.dataCessazione && dateStr > profile.dataCessazione;

        let dayContractHours = 0;
        if (!isCessato && !isWknd && !isHoliday) {
          if (profile?.orarioSettimanale) {
            const weekdayKeys = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
            const key = weekdayKeys[dayOfWeek];
            dayContractHours = profile.orarioSettimanale[key as 'lun' | 'mar' | 'mer' | 'gio' | 'ven'] ?? 8;
          } else {
            dayContractHours = profile?.oreContratto ?? 8;
          }
        }

        let ore = dayContractHours;
        let straordinari = 0;
        let ferie = 0;
        let permessi = 0;
        let malattia = false;
        let trasferta = false;
        let permessoStudio = 0;
        let permessoDonazione = 0;
        let permessoElettorale = 0;

        // Apply approved absences (only on working days)
        if (!isCessato && approvedAbsences[dateStr] && !isWknd && !isHoliday && !isInChiusuraAziendaleLocal(dateStr)) {
          const abs = approvedAbsences[dateStr];
          if (abs.tipo === 'ferie') {
            ore = 0;
            ferie = dayContractHours;
          } else if (abs.tipo === 'malattia' || abs.tipo === 'maternita') {
            ore = 0;
            malattia = true;
          } else if (abs.tipo === 'mattina' || abs.tipo === 'pomeriggio') {
            ore = dayContractHours / 2;
            permessi = dayContractHours / 2;
          } else if (abs.tipo === 'smart') {
            ore = dayContractHours;
          } else if (abs.tipo === 'studio') {
            ore = 0;
            permessoStudio = dayContractHours;
          } else if (abs.tipo === 'donazione') {
            ore = 0;
            permessoDonazione = dayContractHours;
          } else if (abs.tipo === 'elettorale') {
            ore = 0;
            permessoElettorale = dayContractHours;
          } else if (abs.tipo === 'permesso') {
            let hrs = dayContractHours / 2;
            if (abs.frazioneTipo === 'giornata') {
              hrs = dayContractHours;
            } else if (abs.frazioneTipo === 'mattina' || abs.frazioneTipo === 'pomeriggio') {
              hrs = dayContractHours / 2;
            } else if (abs.frazioneTipo === 'orario' && abs.oraInizio && abs.oraFine) {
              const [hStart, mStart] = abs.oraInizio.split(':').map(Number);
              const [hEnd, mEnd] = abs.oraFine.split(':').map(Number);
              const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
              hrs = Math.round((diffMs / 3600000) * 100) / 100;
              if (abs.pausaPranzo && abs.pausaPranzoOre) {
                hrs = Math.max(0, hrs - abs.pausaPranzoOre);
              }
            } else if (abs.oraInizio && abs.oraFine) {
              // fallback per permessi legacy senza frazioneTipo
              const [hStart, mStart] = abs.oraInizio.split(':').map(Number);
              const [hEnd, mEnd] = abs.oraFine.split(':').map(Number);
              const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
              hrs = Math.round((diffMs / 3600000) * 100) / 100;
              if (abs.pausaPranzo && abs.pausaPranzoOre) {
                hrs = Math.max(0, hrs - abs.pausaPranzoOre);
              }
            }
            ore = Math.max(0, dayContractHours - hrs);
            permessi = hrs;
          }
        }

        giorni[String(day)] = {
          ore,
          straordinari,
          ferie,
          permessi,
          malattia,
          trasferta,
          oreContratto: dayContractHours,
          permessoStudio,
          permessoDonazione,
          permessoElettorale
        };
      }

      // 3. Create document in Firestore
      const docId = `${myAssociatedName}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
      const docRef = doc(db, 'presenze', docId);

      const isCollab = isCollaboratore(myAssociatedName, dipendenti);
      const dailyRate = profile?.dailyRate ?? 0;
      const inpsRate = profile?.inpsRate ?? 0;
      const ivaRate = profile?.ivaRate ?? 0;
      const raRate = profile?.raRate ?? 0;



      const newRapportino: RapportinoPresenze = {
        id: docId,
        dipendenteNome: myAssociatedName,
        dipendenteEmail: userEmail,
        mese: selectedMonth,
        anno: selectedYear,
        stato: 'Bozza',
        noteDipendente: '',
        comunicazioniHR: '',
        noteHR: '',
        giorni,
        timestamp: new Date().toISOString()
      };

      if (isCollab) {
        newRapportino.collaboratoreData = recalculateCollabData(
          giorni,
          selectedMonth,
          selectedYear,
          {
            giornate: 0,
            dailyRate,
            spese: 0,
            km: 0,
            kmRate: 0.3,
            inpsRate,
            ivaRate,
            raRate,
            compensoMensile: 0,
            rimborsoKm: 0,
            totaleCompenso: 0,
            inps: 0,
            iva: 0,
            ra: 0,
            totaleDovuto: 0,
            importoFissoMensile: profile?.importoFissoMensile ?? 0
          },
          profile?.oreContratto ?? 8
        );
      } else {
        newRapportino.rimborsoSpeseData = {
          marcaAutomezzo: '',
          modelloAutomezzo: '',
          speseViaggio: 0,
          speseTaxiBus: 0,
          speseParcheggi: 0,
          speseVitto: 0,
          speseAlloggio: 0,
          spesePedaggi: 0,
          speseAltro: 0,
          altroSpecificare: '',
        };
      }

      setLoadingSheet(true);
      await setDoc(docRef, newRapportino);
      setRapportino(newRapportino);
      setLoadingSheet(false);
    } catch (e) {
      console.error("Errore nella generazione del precompilato:", e);
      setLoadingSheet(false);
    }
  };

  const loadPresenzeData = async () => {
    try {
      // Carica le chiusure aziendali dinamiche da Firestore
      const closuresSnap = await getDocs(collection(db, 'chiusure_aziendali')).catch(err => {
        console.error("Errore query chiusure:", err);
        return null;
      });
      const listClosures: any[] = [];
      if (closuresSnap) {
        closuresSnap.forEach(d => {
          listClosures.push(d.data());
        });
      }
      setChiusureAziendali(listClosures);

      if (viewMode === 'hr') {
        setLoadingHR(true);
        const [presSnap, wkSnap] = await Promise.all([
          getDocs(query(collection(db, 'presenze'), where('mese', '==', selectedMonth), where('anno', '==', selectedYear))),
          getDocs(collection(db, 'richieste_weekend'))
        ]);

        const dataMap: Record<string, RapportinoPresenze> = {};
        presSnap.forEach(docSnap => {
          const docData = { id: docSnap.id, ...docSnap.data() } as RapportinoPresenze;
          const isCollab = isCollaboratore(docData.dipendenteNome, dipendenti);
          if (isCollab && docData.collaboratoreData) {
            const targetProfile = dipendenti.find(d => d.nome.trim().toLowerCase() === docData.dipendenteNome.trim().toLowerCase());
            if (targetProfile) {
              const updatedData = { ...docData.collaboratoreData };
              if (targetProfile.importoFissoMensile !== undefined && (docData.stato === 'Bozza' || docData.stato === 'Richiede Modifica')) {
                if (updatedData.importoFissoMensile !== targetProfile.importoFissoMensile) {
                  updatedData.importoFissoMensile = targetProfile.importoFissoMensile;
                }
              }
              docData.collaboratoreData = recalculateCollabData(
                docData.giorni,
                docData.mese,
                docData.anno,
                updatedData,
                targetProfile?.oreContratto || 8
              );
            }
          }
          dataMap[docSnap.id] = docData;
        });
        setAllRapportini(dataMap);

        if (reviewingRapportino) {
          const updated = dataMap[reviewingRapportino.id];
          if (updated) {
            setReviewingRapportino(updated);
          }
        }

        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        const sixtyDaysAgoIso = `${sixtyDaysAgo.getFullYear()}-${String(sixtyDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(sixtyDaysAgo.getDate()).padStart(2, '0')}`;

        const listWk: any[] = [];
        wkSnap.forEach(docSnap => {
          const data = docSnap.data();
          const reqDate = data.data || '';
          if (data.stato === 'Annullato' || data.stato === 'annullato' || data.stato === 'Annullata' || data.stato === 'Revocato' || data.stato === 'revocato' || data.stato === 'Rifiutato' || data.stato === 'rifiutato') {
            deleteDoc(doc(db, 'richieste_weekend', docSnap.id)).catch(() => {});
            return;
          }
          if (!reqDate || reqDate >= sixtyDaysAgoIso) {
            listWk.push({ id: docSnap.id, ...data });
          }
        });
        setAllWeekendRequests(listWk.sort((a, b) => b.timestamp?.localeCompare(a.timestamp || '') || b.data.localeCompare(a.data)));

        if (isHR || isSocio) {
          const [inviatiSnap, weekendSnap] = await Promise.all([
            getDocs(query(collection(db, 'presenze'), where('stato', '==', 'Inviato'))),
            getDocs(query(collection(db, 'richieste_weekend'), where('stato', '==', 'In attesa')))
          ]);
          setGlobalPendingInviatiCount(inviatiSnap.size);
          setGlobalPendingWeekendCount(weekendSnap.size);
        } else {
          setGlobalPendingInviatiCount(0);
          setGlobalPendingWeekendCount(0);
        }
        setLoadingHR(false);
      }

      const targetEmpName = reviewingRapportino ? reviewingRapportino.dipendenteNome : myAssociatedName;
      if ((viewMode === 'compila' && myAssociatedName) || reviewingRapportino) {
        setLoadingSheet(true);
        
        const startOfYear = `${selectedYear}-01-01`;
        const endOfYear = `${selectedYear}-12-31`;

        const [leavesSnap, docSnap, wkAppSnap, wkAllSnap] = await Promise.all([
          getDocs(query(
            collection(db, 'richieste_ferie'),
            where('dipendenteName', '==', targetEmpName)
          )).catch(err => {
            console.error("Errore query ferie:", err);
            return null;
          }),
          getDoc(doc(db, 'presenze', `${targetEmpName}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`)),
          getDocs(query(collection(db, 'richieste_weekend'), where('dipendenteName', '==', targetEmpName), where('stato', '==', 'Approvato'))).catch(err => {
            console.error("Errore query weekend approvati:", err);
            return null;
          }),
          getDocs(query(collection(db, 'richieste_weekend'), where('dipendenteName', '==', targetEmpName))).catch(err => {
            console.error("Errore query all weekend:", err);
            return null;
          })
        ]);

        const leaves: Record<string, { tipo: string; frazioneTipo?: string; oraInizio?: string; oraFine?: string; pausaPranzo?: boolean; pausaPranzoOre?: number }> = {};
        if (leavesSnap) {
          leavesSnap.forEach(docSnap => {
            const d = docSnap.data();
            if (d.stato !== 'Approvato') return;
            const start = d.dataInizio || d.data;
            if (start && start > endOfYear) return;
            const end = d.dataFine || d.data;
            if (start && end && end >= startOfYear) {
              const [startY, startM, startD] = start.split('-').map(Number);
              const [endY, endM, endD] = end.split('-').map(Number);
              const currDate = new Date(startY, startM - 1, startD);
              const lastDate = new Date(endY, endM - 1, endD);
              while (currDate <= lastDate) {
                const y = currDate.getFullYear();
                const m = String(currDate.getMonth() + 1).padStart(2, '0');
                const dStr = String(currDate.getDate()).padStart(2, '0');
                const dateStr = `${y}-${m}-${dStr}`;
                if (dateStr.startsWith(`${selectedYear}-${String(selectedMonth).padStart(2, '0')}`)) {
                  leaves[dateStr] = {
                    tipo: d.tipo,
                    frazioneTipo: d.frazioneTipo,
                    oraInizio: d.oraInizio,
                    oraFine: d.oraFine,
                    pausaPranzo: d.pausaPranzo || false,
                    pausaPranzoOre: d.pausaPranzoOre || 0
                  };
                }
                currDate.setDate(currDate.getDate() + 1);
              }
            }
          });
        }
        setApprovedLeaves(leaves);

        const weekendsAppMap: Record<string, boolean> = {};
        if (wkAppSnap) {
          wkAppSnap.forEach(docSnap => {
            weekendsAppMap[docSnap.data().data] = true;
          });
        }
        setApprovedWeekends(weekendsAppMap);

        const myWkList: any[] = [];
        if (wkAllSnap) {
          const sixtyDaysAgo = new Date();
          sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
          const sixtyDaysAgoIso = `${sixtyDaysAgo.getFullYear()}-${String(sixtyDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(sixtyDaysAgo.getDate()).padStart(2, '0')}`;

          wkAllSnap.forEach(docSnap => {
            const data = docSnap.data();
            const reqDate = data.data || '';
            if (data.stato === 'Annullato' || data.stato === 'annullato' || data.stato === 'Annullata' || data.stato === 'Revocato' || data.stato === 'revocato' || data.stato === 'Rifiutato' || data.stato === 'rifiutato') {
              return;
            }
            if (!reqDate || reqDate >= sixtyDaysAgoIso) {
              myWkList.push({ id: docSnap.id, ...data });
            }
          });
        }
        setMyWeekendRequests(myWkList.sort((a, b) => b.data.localeCompare(a.data)));

        if (docSnap.exists()) {
          const data = docSnap.data() as RapportinoPresenze;
          const isCollab = isCollaboratore(targetEmpName, dipendenti);
          
          if (isCollab && !data.collaboratoreData && targetEmpName) {
            const profile = dipendenti.find(d => d.nome.trim().toLowerCase() === targetEmpName.trim().toLowerCase());
            const dailyRate = profile?.dailyRate ?? 0;
            const inpsRate = profile?.inpsRate ?? 0;
            const ivaRate = profile?.ivaRate ?? 0;
            const raRate = profile?.raRate ?? 0;

            data.collaboratoreData = recalculateCollabData(
              data.giorni,
              selectedMonth,
              selectedYear,
              {
                giornate: 0,
                dailyRate,
                spese: 0,
                km: 0,
                kmRate: 0.3,
                inpsRate,
                ivaRate,
                raRate,
                compensoMensile: 0,
                rimborsoKm: 0,
                totaleCompenso: 0,
                inps: 0,
                iva: 0,
                ra: 0,
                totaleDovuto: 0
              },
              profile?.oreContratto ?? 8
            );
          } else if (isCollab && data.collaboratoreData && targetEmpName) {
            const profile = dipendenti.find(d => d.nome.trim().toLowerCase() === targetEmpName.trim().toLowerCase());
            if (profile) {
              const updatedData = { ...data.collaboratoreData };
              if ((!updatedData.dailyRate || updatedData.dailyRate === 0) && profile.dailyRate) {
                updatedData.dailyRate = profile.dailyRate;
              }
              if ((!updatedData.inpsRate || updatedData.inpsRate === 0) && profile.inpsRate) {
                updatedData.inpsRate = profile.inpsRate;
              }
              if ((!updatedData.ivaRate || updatedData.ivaRate === 0) && profile.ivaRate) {
                updatedData.ivaRate = profile.ivaRate;
              }
              if ((!updatedData.raRate || updatedData.raRate === 0) && profile.raRate) {
                updatedData.raRate = profile.raRate;
              }
              if (profile.importoFissoMensile !== undefined && (data.stato === 'Bozza' || data.stato === 'Richiede Modifica')) {
                if (updatedData.importoFissoMensile !== profile.importoFissoMensile) {
                  updatedData.importoFissoMensile = profile.importoFissoMensile;
                }
              }
              data.collaboratoreData = recalculateCollabData(
                data.giorni,
                selectedMonth,
                selectedYear,
                updatedData,
                profile.oreContratto || 8
              );
            }
          }

          if (!isCollab && !data.rimborsoSpeseData) {
            data.rimborsoSpeseData = {
              marcaAutomezzo: '',
              modelloAutomezzo: '',
              speseViaggio: 0,
              speseTaxiBus: 0,
              speseParcheggi: 0,
              speseVitto: 0,
              speseAlloggio: 0,
              spesePedaggi: 0,
              speseAltro: 0,
              altroSpecificare: '',
            };
          }

          let finalData = { ...data, id: docSnap.id } as RapportinoPresenze;
          if ((finalData.stato === 'Bozza' || finalData.stato === 'Richiede Modifica') && !finalData.hrModified && targetEmpName) {
            try {
              const profile = dipendenti.find(d => d.nome.trim().toLowerCase() === targetEmpName.trim().toLowerCase());
              const contractHours = profile?.oreContratto ?? 8;
              const updatedGiorni = { ...finalData.giorni };
              let hasChanges = false;
              const numDays = new Date(selectedYear, selectedMonth, 0).getDate();

              for (let day = 1; day <= 31; day++) {
                if (day > numDays) continue;

                const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                const currentDay = updatedGiorni[String(day)];
                if (!currentDay) continue;

                const isCessato = profile?.dataCessazione && dateStr > profile.dataCessazione;

                if (isCessato) {
                  if (
                    currentDay.oreContratto !== 0 ||
                    currentDay.ore !== 0 ||
                    currentDay.ferie !== 0 ||
                    currentDay.permessi !== 0 ||
                    currentDay.malattia !== false ||
                    currentDay.trasferta !== false ||
                    currentDay.permessoStudio !== 0 ||
                    currentDay.permessoDonazione !== 0 ||
                    currentDay.permessoElettorale !== 0 ||
                    currentDay.straordinari !== 0
                  ) {
                    updatedGiorni[String(day)] = {
                      ...currentDay,
                      oreContratto: 0,
                      ore: 0,
                      ferie: 0,
                      permessi: 0,
                      malattia: false,
                      trasferta: false,
                      permessoStudio: 0,
                      permessoDonazione: 0,
                      permessoElettorale: 0,
                      straordinari: 0
                    };
                    hasChanges = true;
                  }
                  continue;
                }

                const dateObj = new Date(selectedYear, selectedMonth - 1, day);
                const dayOfWeek = dateObj.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                const isHoliday = isItalianHoliday(dateStr);

                // Ricava le ore di contratto specifiche di questa giornata (con fallback alle ore del profilo)
                const dayContractHours = currentDay.oreContratto ?? contractHours;

                // Auto-migrazione per fogli esistenti creati precedentemente
                if (!currentDay.oreContratto) {
                  currentDay.oreContratto = dayContractHours;
                  hasChanges = true;
                }

                const abs = leaves[dateStr];
                if (abs) {
                  let targetOre = (isWeekend || isHoliday) ? 0 : dayContractHours;
                  let targetFerie = 0;
                  let targetPermessi = 0;
                  let targetMalattia = false;
                  let targetTrasferta = currentDay.trasferta;
                  let targetLuogoTrasferta = currentDay.luogoTrasferta || '';
                  let targetItinerarioTrasferta = currentDay.itinerarioTrasferta || '';
                  let targetKmTrasferta = currentDay.kmTrasferta || 0;
                  let targetStraordinari = currentDay.straordinari;
                  let targetNoteGiorno = currentDay.noteGiorno || '';

                  if (!isWeekend && !isHoliday) {
                    if (abs.tipo === 'ferie') {
                      targetOre = 0;
                      targetFerie = dayContractHours;
                    } else if (abs.tipo === 'malattia' || abs.tipo === 'maternita') {
                      targetOre = 0;
                      targetMalattia = true;
                    } else if (abs.tipo === 'mattina' || abs.tipo === 'pomeriggio') {
                      targetOre = dayContractHours / 2;
                      targetPermessi = dayContractHours / 2;
                    } else if (abs.tipo === 'smart') {
                      targetOre = dayContractHours;
                    } else if (abs.tipo === 'permesso') {
                      let hrs = dayContractHours / 2;
                      if (abs.frazioneTipo === 'giornata') {
                        hrs = dayContractHours;
                      } else if (abs.frazioneTipo === 'mattina' || abs.frazioneTipo === 'pomeriggio') {
                        hrs = dayContractHours / 2;
                      } else if (abs.frazioneTipo === 'orario' && abs.oraInizio && abs.oraFine) {
                        const [hStart, mStart] = abs.oraInizio.split(':').map(Number);
                        const [hEnd, mEnd] = abs.oraFine.split(':').map(Number);
                        const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
                        hrs = Math.round((diffMs / 3600000) * 100) / 100;
                        if (abs.pausaPranzo && abs.pausaPranzoOre) {
                          hrs = Math.max(0, hrs - abs.pausaPranzoOre);
                        }
                      } else if (abs.oraInizio && abs.oraFine) {
                        // fallback per permessi legacy senza frazioneTipo
                        const [hStart, mStart] = abs.oraInizio.split(':').map(Number);
                        const [hEnd, mEnd] = abs.oraFine.split(':').map(Number);
                        const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
                        hrs = Math.round((diffMs / 3600000) * 100) / 100;
                        if (abs.pausaPranzo && abs.pausaPranzoOre) {
                          hrs = Math.max(0, hrs - abs.pausaPranzoOre);
                        }
                      }
                      targetOre = Math.max(0, dayContractHours - hrs);
                      targetPermessi = hrs;
                    }
                  }

                  const isFullDayAbsence = abs.tipo === 'ferie' || abs.tipo === 'malattia' || abs.tipo === 'maternita';
                  if (isFullDayAbsence) {
                    targetTrasferta = false;
                    targetLuogoTrasferta = '';
                    targetItinerarioTrasferta = '';
                    targetKmTrasferta = 0;
                    targetStraordinari = 0;
                    targetNoteGiorno = '';
                  }

                  if (
                    currentDay.ore !== targetOre ||
                    currentDay.ferie !== targetFerie ||
                    currentDay.permessi !== targetPermessi ||
                    currentDay.malattia !== targetMalattia ||
                    currentDay.trasferta !== targetTrasferta ||
                    currentDay.luogoTrasferta !== targetLuogoTrasferta ||
                    currentDay.itinerarioTrasferta !== targetItinerarioTrasferta ||
                    currentDay.kmTrasferta !== targetKmTrasferta ||
                    currentDay.straordinari !== targetStraordinari ||
                    (currentDay.noteGiorno || '') !== targetNoteGiorno
                  ) {
                    updatedGiorni[String(day)] = {
                      ...currentDay,
                      ore: targetOre,
                      ferie: targetFerie,
                      permessi: targetPermessi,
                      malattia: targetMalattia,
                      trasferta: targetTrasferta,
                      luogoTrasferta: targetLuogoTrasferta,
                      itinerarioTrasferta: targetItinerarioTrasferta,
                      kmTrasferta: targetKmTrasferta,
                      straordinari: targetStraordinari,
                      noteGiorno: targetNoteGiorno
                    };
                    hasChanges = true;
                  }
                } else {
                  const isCleanFerie = 
                    currentDay.ore === 0 &&
                    currentDay.ferie === dayContractHours &&
                    currentDay.straordinari === 0 &&
                    currentDay.permessi === 0 &&
                    !currentDay.malattia &&
                    !currentDay.trasferta;

                  const isCleanMalattia = 
                    currentDay.ore === 0 &&
                    currentDay.malattia &&
                    currentDay.straordinari === 0 &&
                    currentDay.ferie === 0 &&
                    currentDay.permessi === 0 &&
                    !currentDay.trasferta;

                  const isCleanPermesso = 
                    currentDay.permessi > 0 &&
                    currentDay.ore === Math.max(0, dayContractHours - currentDay.permessi) &&
                    currentDay.straordinari === 0 &&
                    currentDay.ferie === 0 &&
                    !currentDay.malattia &&
                    !currentDay.trasferta;

                  const isCleanStudio = 
                    currentDay.ore === 0 &&
                    currentDay.permessoStudio === dayContractHours &&
                    currentDay.straordinari === 0 &&
                    currentDay.ferie === 0 &&
                    currentDay.permessi === 0 &&
                    !currentDay.malattia &&
                    !currentDay.trasferta;

                  const isCleanDonazione = 
                    currentDay.ore === 0 &&
                    currentDay.permessoDonazione === dayContractHours &&
                    currentDay.straordinari === 0 &&
                    currentDay.ferie === 0 &&
                    currentDay.permessi === 0 &&
                    !currentDay.malattia &&
                    !currentDay.trasferta;

                  const isCleanElettorale = 
                    currentDay.ore === 0 &&
                    currentDay.permessoElettorale === dayContractHours &&
                    currentDay.straordinari === 0 &&
                    currentDay.ferie === 0 &&
                    currentDay.permessi === 0 &&
                    !currentDay.malattia &&
                    !currentDay.trasferta;

                  const wasModifiedDueToAbsence = 
                    isCleanFerie || 
                    isCleanMalattia || 
                    isCleanPermesso || 
                    isCleanStudio || 
                    isCleanDonazione || 
                    isCleanElettorale;

                  if (wasModifiedDueToAbsence) {
                    updatedGiorni[String(day)] = {
                      ...currentDay,
                      ore: (isWeekend || isHoliday) ? 0 : dayContractHours,
                      ferie: 0,
                      permessi: 0,
                      malattia: false,
                      permessoStudio: 0,
                      permessoDonazione: 0,
                      permessoElettorale: 0
                    };
                    hasChanges = true;
                  }
                }
              }

              if (finalData.collaboratoreData) {
                const profile = myAssociatedName ? dipendenti.find(d => d.nome.trim().toLowerCase() === myAssociatedName.trim().toLowerCase()) : null;
                finalData.collaboratoreData = recalculateCollabData(
                  finalData.giorni,
                  finalData.mese,
                  finalData.anno,
                  finalData.collaboratoreData,
                  profile?.oreContratto || 8
                );
              }
              if (hasChanges) {
                finalData.giorni = updatedGiorni;
                const docRef = doc(db, 'presenze', finalData.id);
                await setDoc(docRef, finalData);
              }
            } catch (syncErr) {
              console.error("Error auto-syncing absences in timesheet sheet load:", syncErr);
            }
          }
          setRapportino(finalData);
        } else {
          await createPrefilledRapportino();
        }
        setLoadingSheet(false);
      }
    } catch (err) {
      console.error("Errore in loadPresenzeData:", err);
      setLoadingHR(false);
      setLoadingSheet(false);
    }
  };

  useEffect(() => {
    loadPresenzeData();
  }, [viewMode, selectedMonth, selectedYear, myAssociatedName, isHR, isAdmin, user?.uid, dipendenti]);

  // --- ACTIONS FOR EMPLOYEES ---
  const handleCellChange = (day: string, field: keyof GiornoPresenza, value: any) => {
    if (!rapportino || rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato') return;

    if (isDayLockedForUser(Number(day))) {
      showToast("Questo giorno è bloccato da una richiesta di ferie/assenza approvata dall'HR.", "warning");
      return;
    }

    const updatedGiorni = { ...rapportino.giorni };
    const currentDay = { ...updatedGiorni[day] };
    const profile = myAssociatedName ? dipendenti.find(d => d.nome.trim().toLowerCase() === myAssociatedName.trim().toLowerCase()) : null;
    const defaultContractHours = profile?.oreContratto ?? 8;
    const dayContractHours = currentDay.oreContratto ?? defaultContractHours;

    // Assicura che la giornata abbia il suo valore oreContratto salvato
    currentDay.oreContratto = dayContractHours;

    if (field === 'malattia') {
      currentDay.malattia = value;
      if (value) {
        currentDay.ore = 0;
        currentDay.ferie = 0;
        currentDay.permessi = 0;
        currentDay.straordinari = 0;
      } else {
        currentDay.ore = dayContractHours;
      }
    } else if (field === 'trasferta') {
      currentDay.trasferta = value;
      if (!value) {
        currentDay.luogoTrasferta = '';
      }
    } else if (field === 'ferie') {
      const isChecked = !!value;
      currentDay.ferie = isChecked ? dayContractHours : 0;
      currentDay.ore = isChecked ? 0 : Math.max(0, dayContractHours - (currentDay.permessi || 0));
      if (isChecked) {
        currentDay.permessoStudio = 0;
        currentDay.permessoDonazione = 0;
        currentDay.permessoElettorale = 0;
      }
    } else if (field === 'permessoStudio') {
      const isChecked = !!value;
      currentDay.permessoStudio = isChecked ? dayContractHours : 0;
      if (isChecked) {
        currentDay.ore = 0;
        currentDay.ferie = 0;
        currentDay.permessi = 0;
        currentDay.permessoDonazione = 0;
        currentDay.permessoElettorale = 0;
        currentDay.malattia = false;
      } else {
        currentDay.ore = dayContractHours;
      }
    } else if (field === 'permessoDonazione') {
      const isChecked = !!value;
      currentDay.permessoDonazione = isChecked ? dayContractHours : 0;
      if (isChecked) {
        currentDay.ore = 0;
        currentDay.ferie = 0;
        currentDay.permessi = 0;
        currentDay.permessoStudio = 0;
        currentDay.permessoElettorale = 0;
        currentDay.malattia = false;
      } else {
        currentDay.ore = dayContractHours;
      }
    } else if (field === 'permessoElettorale') {
      const isChecked = !!value;
      currentDay.permessoElettorale = isChecked ? dayContractHours : 0;
      if (isChecked) {
        currentDay.ore = 0;
        currentDay.ferie = 0;
        currentDay.permessi = 0;
        currentDay.permessoStudio = 0;
        currentDay.permessoDonazione = 0;
        currentDay.malattia = false;
      } else {
        currentDay.ore = dayContractHours;
      }
    } else if (field === 'permessi') {
      const numVal = Number(value || 0);
      currentDay.permessi = numVal;
      currentDay.ore = Math.max(0, dayContractHours - (currentDay.ferie || 0) - numVal);
      if (numVal > 0) {
        currentDay.permessoStudio = 0;
        currentDay.permessoDonazione = 0;
        currentDay.permessoElettorale = 0;
      }
    } else if (field === 'ore') {
      const numVal = Number(value || 0);
      currentDay.ore = numVal;
      if (numVal === dayContractHours) {
        currentDay.ferie = 0;
        currentDay.permessi = 0;
        currentDay.permessoStudio = 0;
        currentDay.permessoDonazione = 0;
        currentDay.permessoElettorale = 0;
      }
    } else {
      (currentDay as any)[field] = value;
    }

    updatedGiorni[day] = currentDay;
    let updatedRapportino = { ...rapportino, giorni: updatedGiorni };
    const isCollab = isCollaboratore(myAssociatedName, dipendenti);
    if (isCollab && updatedRapportino.collaboratoreData) {
      const profile = myAssociatedName ? dipendenti.find(d => d.nome.trim().toLowerCase() === myAssociatedName.trim().toLowerCase()) : null;
      updatedRapportino.collaboratoreData = recalculateCollabData(
        updatedRapportino.giorni,
        updatedRapportino.mese,
        updatedRapportino.anno,
        updatedRapportino.collaboratoreData,
        profile?.oreContratto ?? 8
      );
    }
    setRapportino(updatedRapportino);
  };

  const handleAddTratta = (dayKey: string, isReview: boolean = false) => {
    const currentRapportino = isReview ? reviewingRapportino : rapportino;
    if (!currentRapportino) return;
    const currentG = currentRapportino.giorni[dayKey] || {};
    const currentTratte = getTratteForGiorno(currentG);
    const newTratte = [...currentTratte, { partenza: '', arrivo: '' }];
    
    const summaryStr = newTratte
      .filter(t => t.partenza || t.arrivo)
      .map(t => `${t.partenza || '?'} -> ${t.arrivo || '?'}`)
      .join('; ');

    const updatedG = {
      ...currentG,
      tratte: newTratte,
      itinerarioTrasferta: summaryStr,
      luogoTrasferta: newTratte[0]?.arrivo || summaryStr
    };

    if (isReview) {
      setReviewingRapportino({
        ...currentRapportino,
        giorni: { ...currentRapportino.giorni, [dayKey]: updatedG }
      });
    } else {
      setRapportino({
        ...currentRapportino,
        giorni: { ...currentRapportino.giorni, [dayKey]: updatedG }
      });
    }
  };

  const handleUpdateTratta = (dayKey: string, index: number, field: 'partenza' | 'arrivo', value: string, isReview: boolean = false) => {
    const currentRapportino = isReview ? reviewingRapportino : rapportino;
    if (!currentRapportino) return;
    const currentG = currentRapportino.giorni[dayKey] || {};
    const currentTratte = [...getTratteForGiorno(currentG)];
    currentTratte[index] = {
      ...currentTratte[index],
      [field]: value
    };

    const summaryStr = currentTratte
      .filter(t => t.partenza || t.arrivo)
      .map(t => `${t.partenza || '?'} -> ${t.arrivo || '?'}`)
      .join('; ');

    const updatedG = {
      ...currentG,
      tratte: currentTratte,
      itinerarioTrasferta: summaryStr,
      luogoTrasferta: currentTratte[0]?.arrivo || summaryStr
    };

    if (isReview) {
      setReviewingRapportino({
        ...currentRapportino,
        giorni: { ...currentRapportino.giorni, [dayKey]: updatedG }
      });
    } else {
      setRapportino({
        ...currentRapportino,
        giorni: { ...currentRapportino.giorni, [dayKey]: updatedG }
      });
    }
  };

  const handleRemoveTratta = (dayKey: string, index: number, isReview: boolean = false) => {
    const currentRapportino = isReview ? reviewingRapportino : rapportino;
    if (!currentRapportino) return;
    const currentG = currentRapportino.giorni[dayKey] || {};
    let currentTratte = getTratteForGiorno(currentG).filter((_, idx) => idx !== index);
    if (currentTratte.length === 0) {
      currentTratte = [{ partenza: '', arrivo: '' }];
    }

    const summaryStr = currentTratte
      .filter(t => t.partenza || t.arrivo)
      .map(t => `${t.partenza || '?'} -> ${t.arrivo || '?'}`)
      .join('; ');

    const updatedG = {
      ...currentG,
      tratte: currentTratte,
      itinerarioTrasferta: summaryStr,
      luogoTrasferta: currentTratte[0]?.arrivo || summaryStr
    };

    if (isReview) {
      setReviewingRapportino({
        ...currentRapportino,
        giorni: { ...currentRapportino.giorni, [dayKey]: updatedG }
      });
    } else {
      setRapportino({
        ...currentRapportino,
        giorni: { ...currentRapportino.giorni, [dayKey]: updatedG }
      });
    }
  };
  const handleCollabFieldChange = (field: string, value: number | string) => {
    if (!rapportino || !rapportino.collaboratoreData || rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato') return;

    const data = { ...rapportino.collaboratoreData };
    (data as any)[field] = value;
    if (field === 'importoFissoMensile' && Number(value) > 0) {
      data.dailyRate = 0;
    }

    const profile = myAssociatedName ? dipendenti.find(d => d.nome.trim().toLowerCase() === myAssociatedName.trim().toLowerCase()) : null;
    const updatedCollabData = recalculateCollabData(
      rapportino.giorni,
      rapportino.mese,
      rapportino.anno,
      data,
      profile?.oreContratto ?? 8
    );

    setRapportino({
      ...rapportino,
      collaboratoreData: updatedCollabData
    });
  };

  const handleReviewCollabFieldChange = (field: string, value: number | string) => {
    if (!reviewingRapportino || !reviewingRapportino.collaboratoreData) return;

    const data = { ...reviewingRapportino.collaboratoreData };
    (data as any)[field] = value;
    if (field === 'importoFissoMensile' && Number(value) > 0) {
      data.dailyRate = 0;
    }

    const targetProfile = dipendenti.find(d => d.nome.trim().toLowerCase() === reviewingRapportino.dipendenteNome.trim().toLowerCase());
    const updatedCollabData = recalculateCollabData(
      reviewingRapportino.giorni,
      reviewingRapportino.mese,
      reviewingRapportino.anno,
      data,
      targetProfile?.oreContratto ?? 8
    );

    setReviewingRapportino({
      ...reviewingRapportino,
      collaboratoreData: updatedCollabData
    });
  };

  const handleRimborsoFieldChange = (field: string, value: any) => {
    if (!rapportino || rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato') return;

    const currentRimborso = rapportino.rimborsoSpeseData || {
      marcaAutomezzo: '',
      modelloAutomezzo: '',
      speseViaggio: 0,
      speseTaxiBus: 0,
      speseParcheggi: 0,
      speseVitto: 0,
      speseAlloggio: 0,
      spesePedaggi: 0,
      speseAltro: 0,
      altroSpecificare: ''
    };

    const updatedRimborso = {
      ...currentRimborso,
      [field]: value
    };

    setRapportino({
      ...rapportino,
      rimborsoSpeseData: updatedRimborso
    });
  };

  const handleReviewRimborsoFieldChange = (field: string, value: any) => {
    if (!reviewingRapportino) return;

    const currentRimborso = reviewingRapportino.rimborsoSpeseData || {
      marcaAutomezzo: '',
      modelloAutomezzo: '',
      speseViaggio: 0,
      speseTaxiBus: 0,
      speseParcheggi: 0,
      speseVitto: 0,
      speseAlloggio: 0,
      spesePedaggi: 0,
      speseAltro: 0,
      altroSpecificare: ''
    };

    const updatedRimborso = {
      ...currentRimborso,
      [field]: value
    };

    setReviewingRapportino({
      ...reviewingRapportino,
      rimborsoSpeseData: updatedRimborso
    });
  };

  const saveCollabProfileRates = async (collabData: any, targetName?: string) => {
    try {
      const name = targetName || myAssociatedName;
      if (!name) return;
      const profile = dipendenti.find(d => d.nome.trim().toLowerCase() === name.trim().toLowerCase());
      if (profile) {
        await updateDoc(doc(db, 'dipendenti', profile.id), {
          dailyRate: collabData.dailyRate,
          inpsRate: collabData.inpsRate,
          ivaRate: collabData.ivaRate,
          raRate: collabData.raRate,
          importoFissoMensile: collabData.importoFissoMensile !== undefined && collabData.importoFissoMensile !== null ? Number(collabData.importoFissoMensile) : null
        });
        await refreshData();
      }
    } catch (err) {
      console.error("Errore aggiornamento tariffe profilo:", err);
    }
  };

  const handleSaveDraft = async () => {
    if (!rapportino) return;
    setSaving(true);
    try {
      const docRef = doc(db, 'presenze', rapportino.id);
      await setDoc(docRef, {
        ...rapportino,
        timestamp: new Date().toISOString()
      });

      const isCollab = isCollaboratore(myAssociatedName, dipendenti);
      if (isCollab && rapportino.collaboratoreData) {
        await saveCollabProfileRates(rapportino.collaboratoreData);
      }

      showToast("Bozza salvata con successo!");
      loadPresenzeData();
    } catch (err) {
      console.error("Errore salvataggio bozza:", err);
      showToast("Errore durante il salvataggio.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitToHR = () => {
    if (!rapportino) return;
    const isCollab = isCollaboratore(myAssociatedName, dipendenti);
    triggerConfirm(
      isCollab ? "Invio Bozza Fattura" : "Invio Rapportino",
      isCollab 
        ? "Confermi l'invio della bozza fattura all'HR? Una volta inviata non potrai più modificarla, a meno che non ti venga richiesto."
        : "Confermi l'invio del foglio presenze all'HR? Una volta inviato non potrai più modificarlo, a meno che non ti venga richiesto.",
      async () => {
        setSubmitting(true);
        try {
          const docRef = doc(db, 'presenze', rapportino.id);
          const updated: RapportinoPresenze = {
            ...rapportino,
            stato: 'Inviato',
            submittedAt: new Date().toISOString()
          };
          await setDoc(docRef, updated);

          const isCollab = isCollaboratore(myAssociatedName, dipendenti);
          if (isCollab && rapportino.collaboratoreData) {
            await saveCollabProfileRates(rapportino.collaboratoreData);
          }

          setRapportino(updated);
          showToast(isCollab ? "Bozza fattura inviata con successo all'HR!" : "Foglio presenze inviato con successo all'HR!");
          loadPresenzeData();
        } catch (err) {
          console.error("Errore invio rapportino:", err);
          showToast("Errore durante l'invio.", "error");
        } finally {
          setSubmitting(false);
        }
      },
      'info'
    );
  };

  const handleRequestWeekendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myAssociatedName || !userEmail) return;
    if (!reqWeekendData) {
      showToast("Seleziona una data!", "warning");
      return;
    }

    const todayObj = new Date();
    const todayStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;
    if (reqWeekendData <= todayStr) {
      showToast("Le richieste di autorizzazione per lavoro festivo/straordinario devono essere inviate con almeno 1 giorno di anticipo (entro la mezzanotte del giorno precedente).", "warning");
      return;
    }

    setReqWeekendLoading(true);
    try {
      await addDoc(collection(db, 'richieste_weekend'), {
        dipendenteName: myAssociatedName,
        dipendenteEmail: userEmail,
        data: reqWeekendData,
        motivo: reqWeekendMotivo,
        stato: 'In attesa',
        timestamp: new Date().toISOString()
      });
      setReqWeekendData('');
      setReqWeekendMotivo('');
      showToast("Richiesta inviata con successo!");
      loadPresenzeData();
    } catch (err) {
      console.error("Errore invio richiesta:", err);
      showToast("Errore nell'invio della richiesta.", "error");
    } finally {
      setReqWeekendLoading(false);
    }
  };

  const handleWeekendDecision = async (id: string, action: 'Approvato' | 'Rifiutato' | 'Revocato' | 'Annullato') => {
    try {
      const req = allWeekendRequests.find(r => r.id === id);
      if (!req) return;
      
      const updates: Record<string, any> = { stato: action };

      // Se accetta una modifica e la richiesta aveva una nuovaData
      if (action === 'Approvato' && req.nuovaData) {
        updates.data = req.nuovaData;
        if (req.nuovoMotivo) updates.motivo = req.nuovoMotivo;
        updates.nuovaData = null;
        updates.nuovoMotivo = null;
      }

      if (action === 'Annullato' || action === 'Revocato' || action === 'Rifiutato') {
        await deleteDoc(doc(db, 'richieste_weekend', id));
      } else {
        await updateDoc(doc(db, 'richieste_weekend', id), updates);
      }
      loadPresenzeData();

      // Invia email al dipendente
      const targetDip = dipendenti.find(d => d.nome === req.dipendenteName);
      if (targetDip && targetDip.email) {
        const isSelfTarget = (targetDip.email.toLowerCase() === userEmail?.toLowerCase()) || (myAssociatedName && req.dipendenteName === myAssociatedName);
        if (!isSelfTarget) {
          let actionText = 'aggiornata';
          if (action === 'Approvato') actionText = 'approvata';
          else if (action === 'Rifiutato') actionText = 'rifiutata';
          else if (action === 'Revocato') actionText = 'revocata dall\'HR';
          else if (action === 'Annullato') actionText = 'annullata';

          const subject = `[Notifica] Autorizzazione lavoro festivo ${actionText}`;
          const htmlBody = `
            <p>Ciao <strong>${req.dipendenteName}</strong>,</p>
            <p>La tua richiesta di autorizzazione per il lavoro festivo del giorno <strong>${formatDate(req.data)}</strong> (${req.motivo}) è stata <strong>${actionText}</strong>.</p>
            ${action === 'Approvato' ? '<p>Puoi procedere all\'inserimento delle ore sul tuo foglio presenze.</p>' : ''}
          `;
          const plainText = `Ciao ${req.dipendenteName},\n\nLa tua richiesta di autorizzazione per il lavoro festivo del giorno ${formatDate(req.data)} (${req.motivo}) è stata ${actionText}.\n\nQuesta è una notifica automatica.`;
          await queueMail(targetDip.email.toLowerCase(), subject, htmlBody, plainText);
        }
      }
      showToast(`Richiesta ${action.toLowerCase()} con successo!`);
    } catch (e) {
      console.error("Errore decisione weekend:", e);
      showToast("Errore durante l'aggiornamento della richiesta.", "error");
    }
  };

  const handleCancelPendingWeekendRequest = async (id: string) => {
    triggerConfirm(
      "Annulla Richiesta",
      "Sei sicuro di voler eliminare questa richiesta di lavoro festivo in attesa?",
      async () => {
        try {
          await deleteDoc(doc(db, 'richieste_weekend', id));
          showToast("Richiesta eliminata con successo!");
          loadPresenzeData();
        } catch (err) {
          console.error("Errore eliminazione richiesta:", err);
          showToast("Errore durante l'eliminazione della richiesta.", "error");
        }
      }
    );
  };

  const handleRequestWeekendModificationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modifyingWeekendReq) return;

    setModWeekendLoading(true);
    try {
      if (modWeekendTipo === 'annullamento') {
        await updateDoc(doc(db, 'richieste_weekend', modifyingWeekendReq.id), {
          stato: 'Richiesta Annullamento',
          noteModifica: modWeekendMotivo.trim() || 'Richiesta di annullamento dal dipendente'
        });
      } else {
        if (!modWeekendNuovaData) {
          showToast("Seleziona la nuova data desiderata!", "warning");
          setModWeekendLoading(false);
          return;
        }
        await updateDoc(doc(db, 'richieste_weekend', modifyingWeekendReq.id), {
          stato: 'Richiesta Modifica',
          nuovaData: modWeekendNuovaData,
          nuovoMotivo: modWeekendMotivo.trim() || modifyingWeekendReq.motivo
        });
      }

      setModifyingWeekendReq(null);
      setModWeekendMotivo('');
      setModWeekendNuovaData('');
      showToast("Richiesta inviata all'HR con successo!");
      loadPresenzeData();
    } catch (err) {
      console.error("Errore invio richiesta modifica/annullamento:", err);
      showToast("Errore durante l'invio della richiesta.", "error");
    } finally {
      setModWeekendLoading(false);
    }
  };

  const handleDirectWeekendAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directAuthDipNome) {
      showToast("Seleziona una risorsa!", "warning");
      return;
    }
    if (!directAuthData) {
      showToast("Seleziona una data!", "warning");
      return;
    }

    const selectedDip = dipendenti.find(d => d.nome === directAuthDipNome);
    const email = selectedDip?.email || '';

    setDirectAuthLoading(true);
    try {
      await addDoc(collection(db, 'richieste_weekend'), {
        dipendenteName: directAuthDipNome,
        dipendenteEmail: email.toLowerCase(),
        data: directAuthData,
        motivo: directAuthMotivo || 'Autorizzazione d\'ufficio dall\'HR',
        stato: 'Approvato',
        timestamp: new Date().toISOString()
      });
      setDirectAuthDipNome('');
      setDirectAuthData('');
      setDirectAuthMotivo('');
      showToast("Autorizzazione registrata ed approvata con successo!");
      loadPresenzeData();
    } catch (err) {
      console.error("Errore invio autorizzazione diretta:", err);
      showToast("Errore durante la registrazione dell'autorizzazione.", "error");
    } finally {
      setDirectAuthLoading(false);
    }
  };

  // --- ACTIONS FOR HR / ADMIN ---
  const handleReviewCellChange = (day: string, field: keyof GiornoPresenza, value: any) => {
    if (!reviewingRapportino) return;

    const updatedGiorni = { ...reviewingRapportino.giorni };
    const currentDay = { ...updatedGiorni[day] };
    const targetProfile = dipendenti.find(d => d.nome.trim().toLowerCase() === reviewingRapportino.dipendenteNome.trim().toLowerCase());
    const defaultContractHours = targetProfile?.oreContratto ?? 8;
    const dayContractHours = currentDay.oreContratto ?? defaultContractHours;

    // Assicura che la giornata abbia il suo valore oreContratto salvato
    currentDay.oreContratto = dayContractHours;

    if (field === 'malattia') {
      currentDay.malattia = value;
      if (value) {
        currentDay.ore = 0;
        currentDay.ferie = 0;
        currentDay.permessi = 0;
        currentDay.straordinari = 0;
      } else {
        currentDay.ore = dayContractHours;
      }
    } else if (field === 'trasferta') {
      currentDay.trasferta = value;
      if (!value) {
        currentDay.luogoTrasferta = '';
      }
    } else if (field === 'ferie') {
      const isChecked = !!value;
      currentDay.ferie = isChecked ? dayContractHours : 0;
      currentDay.ore = isChecked ? 0 : Math.max(0, dayContractHours - (currentDay.permessi || 0));
      if (isChecked) {
        currentDay.permessoStudio = 0;
        currentDay.permessoDonazione = 0;
        currentDay.permessoElettorale = 0;
      }
    } else if (field === 'permessoStudio') {
      const isChecked = !!value;
      currentDay.permessoStudio = isChecked ? dayContractHours : 0;
      if (isChecked) {
        currentDay.ore = 0;
        currentDay.ferie = 0;
        currentDay.permessi = 0;
        currentDay.permessoDonazione = 0;
        currentDay.permessoElettorale = 0;
        currentDay.malattia = false;
      } else {
        currentDay.ore = dayContractHours;
      }
    } else if (field === 'permessoDonazione') {
      const isChecked = !!value;
      currentDay.permessoDonazione = isChecked ? dayContractHours : 0;
      if (isChecked) {
        currentDay.ore = 0;
        currentDay.ferie = 0;
        currentDay.permessi = 0;
        currentDay.permessoStudio = 0;
        currentDay.permessoElettorale = 0;
        currentDay.malattia = false;
      } else {
        currentDay.ore = dayContractHours;
      }
    } else if (field === 'permessoElettorale') {
      const isChecked = !!value;
      currentDay.permessoElettorale = isChecked ? dayContractHours : 0;
      if (isChecked) {
        currentDay.ore = 0;
        currentDay.ferie = 0;
        currentDay.permessi = 0;
        currentDay.permessoStudio = 0;
        currentDay.permessoDonazione = 0;
        currentDay.malattia = false;
      } else {
        currentDay.ore = dayContractHours;
      }
    } else if (field === 'permessi') {
      const numVal = Number(value || 0);
      currentDay.permessi = numVal;
      currentDay.ore = Math.max(0, dayContractHours - (currentDay.ferie || 0) - numVal);
      if (numVal > 0) {
        currentDay.permessoStudio = 0;
        currentDay.permessoDonazione = 0;
        currentDay.permessoElettorale = 0;
      }
    } else if (field === 'ore') {
      const numVal = Number(value || 0);
      currentDay.ore = numVal;
      if (numVal === dayContractHours) {
        currentDay.ferie = 0;
        currentDay.permessi = 0;
        currentDay.permessoStudio = 0;
        currentDay.permessoDonazione = 0;
        currentDay.permessoElettorale = 0;
      }
    } else {
      (currentDay as any)[field] = value;
    }

    updatedGiorni[day] = currentDay;
    let updatedRapportino = { ...reviewingRapportino, giorni: updatedGiorni };
    const isCollab = isCollaboratore(reviewingRapportino.dipendenteNome, dipendenti);
    if (isCollab && updatedRapportino.collaboratoreData) {
      const targetProfile = dipendenti.find(d => d.nome.trim().toLowerCase() === reviewingRapportino.dipendenteNome.trim().toLowerCase());
      updatedRapportino.collaboratoreData = recalculateCollabData(
        updatedRapportino.giorni,
        updatedRapportino.mese,
        updatedRapportino.anno,
        updatedRapportino.collaboratoreData,
        targetProfile?.oreContratto ?? 8
      );
    }
    setReviewingRapportino(updatedRapportino);
  };

  const handleHRApprove = () => {
    if (!reviewingRapportino) return;
    const isCollab = isCollaboratore(reviewingRapportino.dipendenteNome, dipendenti);
    if (reviewingRapportino.stato === 'Bozza') {
      showToast(isCollab ? "Impossibile approvare una bozza fattura in stato Bozza." : "Impossibile approvare un rapportino in stato Bozza.", "warning");
      return;
    }
    triggerConfirm(
      isCollab ? "Approva Bozza Fattura" : "Approva Rapportino",
      isCollab 
        ? `Approvare la bozza fattura di ${reviewingRapportino.dipendenteNome}?`
        : `Approvare il foglio presenze di ${reviewingRapportino.dipendenteNome}?`,
      async () => {
        try {
          const docRef = doc(db, 'presenze', reviewingRapportino.id);
          const updated: RapportinoPresenze = {
            ...reviewingRapportino,
            stato: 'Approvato',
            approvedAt: new Date().toISOString(),
            approvedBy: user?.email || 'HR'
          };
          await setDoc(docRef, updated);

          if (isCollab && reviewingRapportino.collaboratoreData) {
            await saveCollabProfileRates(reviewingRapportino.collaboratoreData, reviewingRapportino.dipendenteNome);
          }

          setReviewingRapportino(null);
          showToast(isCollab ? "Bozza fattura approvata!" : "Rapportino approvato!");
          loadPresenzeData();

          // Invia notifica al dipendente (se non è se stesso)
          const isSelfTarget = (updated.dipendenteEmail?.toLowerCase() === userEmail?.toLowerCase()) || (myAssociatedName && updated.dipendenteNome === myAssociatedName);
          if (updated.dipendenteEmail && !isSelfTarget) {
            const meseNome = MESI[selectedMonth - 1];
            await queueMail(
              updated.dipendenteEmail,
              isCollab 
                ? `[Pianificazione] Bozza Fattura Approvata - ${meseNome} ${selectedYear}`
                : `[Pianificazione] Rapportino Presenze Approvato - ${meseNome} ${selectedYear}`,
              `
                <p>Ciao <strong>${updated.dipendenteNome}</strong>,</p>
                <p>La tua ${isCollab ? 'bozza fattura' : 'bozza di rapportino presenze'} per il mese di <strong>${meseNome} ${selectedYear}</strong> è stata verificata ed <strong>approvata</strong> dall'amministrazione.</p>
                <p>Grazie per la collaborazione.</p>
              `
            );
          }
        } catch (err) {
          console.error("Errore approvazione:", err);
          showToast("Errore durante l'approvazione.", "error");
        }
      },
      'info'
    );
  };

  const handleHRRevokeApproval = () => {
    if (!reviewingRapportino) return;
    const isCollab = isCollaboratore(reviewingRapportino.dipendenteNome, dipendenti);
    triggerConfirm(
      isCollab ? "Revoca Approvazione Bozza Fattura" : "Revoca Approvazione Rapportino",
      isCollab 
        ? `Sei sicuro di voler revocare l'approvazione della bozza fattura di ${reviewingRapportino.dipendenteNome}? Il documento tornerà modificabile.`
        : `Sei sicuro di voler revocare l'approvazione del foglio presenze di ${reviewingRapportino.dipendenteNome}? Il documento tornerà modificabile.`,
      async () => {
        try {
          const docRef = doc(db, 'presenze', reviewingRapportino.id);
          const updated: RapportinoPresenze = {
            ...reviewingRapportino,
            stato: 'Inviato',
            approvedAt: undefined,
            approvedBy: undefined
          };
          await setDoc(docRef, updated);

          setReviewingRapportino(updated);
          showToast("Approvazione revocata con successo. Il documento è ora sbloccato e modificabile.", "success");
          loadPresenzeData();
        } catch (err) {
          console.error("Errore revoca approvazione:", err);
          showToast("Errore durante la revoca dell'approvazione.", "error");
        }
      },
      'warning'
    );
  };

  const handleHRRequestChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingRapportino || !hrFeedbackNote.trim()) return;

    try {
      const docRef = doc(db, 'presenze', reviewingRapportino.id);
      const updated: RapportinoPresenze = {
        ...reviewingRapportino,
        stato: 'Richiede Modifica',
        noteHR: hrFeedbackNote
      };
      await setDoc(docRef, updated);
      setReviewingRapportino(null);
      setIsFeedbackModalOpen(false);
      setHrFeedbackNote('');
      showToast("Richiesta di modifica inviata al dipendente.");
      loadPresenzeData();

      // Invia notifica al dipendente (se non è se stesso)
      const isSelfTarget = (updated.dipendenteEmail?.toLowerCase() === userEmail?.toLowerCase()) || (myAssociatedName && updated.dipendenteNome === myAssociatedName);
      if (updated.dipendenteEmail && !isSelfTarget) {
        const meseNome = MESI[selectedMonth - 1];
        await queueMail(
          updated.dipendenteEmail,
          `[Pianificazione] Correzione richiesta per il tuo Rapportino Presenze - ${meseNome} ${selectedYear}`,
          `
            <p>Ciao <strong>${updated.dipendenteNome}</strong>,</p>
            <p>L'amministrazione ha esaminato il tuo rapportino presenze per il mese di <strong>${meseNome} ${selectedYear}</strong> e ha richiesto alcune <strong>correzioni</strong>.</p>
            <p><strong>Nota dell'HR:</strong></p>
            <blockquote style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 10px 15px; margin: 10px 0; font-style: italic;">
              "${hrFeedbackNote}"
            </blockquote>
            <p>Accedi alla piattaforma per effettuare le modifiche richieste e inviarlo nuovamente.</p>
          `
        );
      }
    } catch (err) {
      console.error("Errore invio modifiche:", err);
      showToast("Errore durante l'invio.", "error");
    }
  };

  const handleHRSaveModifications = async () => {
    if (!reviewingRapportino) return;
    try {
      const updatedSheet: RapportinoPresenze = {
        ...reviewingRapportino,
        hrModified: true
      };
      const docRef = doc(db, 'presenze', reviewingRapportino.id);
      await setDoc(docRef, updatedSheet);

      const isCollab = isCollaboratore(reviewingRapportino.dipendenteNome, dipendenti);
      if (isCollab && reviewingRapportino.collaboratoreData) {
        await saveCollabProfileRates(reviewingRapportino.collaboratoreData, reviewingRapportino.dipendenteNome);
      }

      setReviewingRapportino(updatedSheet);
      showToast("Modifiche salvate con successo!");
      loadPresenzeData();
    } catch (err) {
      console.error("Errore salvataggio modifiche HR:", err);
      showToast("Errore durante il salvataggio.", "error");
    }
  };

  // --- DECIMAL FORMATTING UTILITY (Italian Locale: "." for thousands, "," for decimals) ---
  const formatDec = (val: number | string | undefined | null): string => {
    if (val === undefined || val === null || val === '') return '';
    const num = typeof val === 'number' ? val : parseFloat(val.toString().replace(/\./g, '').replace(',', '.'));
    if (isNaN(num)) return val.toString();
    return num.toLocaleString('it-IT', {
      maximumFractionDigits: 2
    });
  };

  // --- CALCULATION TOTALS FOR A SINGLE SHEET ---
  const calculateTotals = (giorni: { [giorno: string]: GiornoPresenza }, numDays: number) => {
    let oreOrd = 0;
    let oreStra = 0;
    let oreFerie = 0;
    let orePerm = 0;
    let ggMalattia = 0;
    let oreMalattia = 0;
    let ggTrasferta = 0;
    let ggIntere = 0;
    let ggMezze = 0;
    let oreStudio = 0;
    let oreDonazione = 0;
    let oreElettorale = 0;

    let ggRimborsoKm = 0;
    let totalKm = 0;

    for (let d = 1; d <= numDays; d++) {
      const g = giorni[String(d)];
      if (g) {
        oreOrd += Number(g.ore || 0);
        oreStra += Number(g.straordinari || 0);
        oreFerie += Number(g.ferie || 0);
        orePerm += Number(g.permessi || 0);
        if (g.malattia) {
          ggMalattia++;
          oreMalattia += Number(g.oreContratto || contractHours || 8);
        }
        if (g.trasferta) ggTrasferta++;
        if (g.rimborsoKm) ggRimborsoKm++;
        totalKm += Number(g.kmTrasferta || 0);

        oreStudio += Number(g.permessoStudio || 0);
        oreDonazione += Number(g.permessoDonazione || 0);
        oreElettorale += Number(g.permessoElettorale || 0);

        if (g.ore === 8) ggIntere++;
        if (g.ore === 4) ggMezze++;
      }
    }

    return { oreOrd, oreStra, oreFerie, orePerm, ggMalattia, oreMalattia, ggTrasferta, ggRimborsoKm, totalKm, ggIntere, ggMezze, oreStudio, oreDonazione, oreElettorale };
  };

  // --- EXPORT TO EXCEL (CSV COMPATIBLE) ---
  const handleExportMonthlyExcel = () => {
    try {
      const isCollabExport = hrTab === 'collaboratori';
      
      const headers = isCollabExport ? [
        "Collaboratore",
        "Email",
        "Mese",
        "Anno",
        "Stato Rapportino",
        "Giornate Lavorate",
        "Tariffa Giornaliera (€)",
        "Compenso Mensile (€)",
        "Spese (€)",
        "Km Percorsi",
        "Tariffa Km (€/km)",
        "Rimborso Km (€)",
        "Totale Compenso (€)",
        "Cassa INPS (€)",
        "IVA (€)",
        "Ritenuta d'Acconto (€)",
        "Totale Dovuto (€)"
      ] : [
        "Dipendente",
        "Email",
        "Mese",
        "Anno",
        "Stato Rapportino",
        "Ore Ordinarie Lavorate",
        "Ore Straordinari",
        "Ore Ferie",
        "Ore Permessi",
        "Giorni Malattia (M)",
        "Giorni Trasferta (T)",
        "Marca Auto",
        "Modello Auto",
        "Km Totali",
        "Spese Viaggio (€)",
        "Spese Taxi/Bus (€)",
        "Spese Parcheggi (€)",
        "Spese Vitto (€)",
        "Spese Alloggio (€)",
        "Spese Pedaggi (€)",
        "Spese Altro (€)",
        "Dettaglio Altro",
        "Totale Altre Spese (€)"
      ];

      const activeList = filteredDipendenti.filter(dip => {
        const firstDayOfMonthStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
        if (dip.dataCessazione && dip.dataCessazione < firstDayOfMonthStr) return false;
        const isCollab = isCollaboratore(dip.nome, dipendenti);
        return isCollabExport ? isCollab : !isCollab;
      });

      const rows = activeList.map(dip => {
        const docId = `${dip.nome}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
        const sheet = allRapportini[docId];
        const status = sheet ? sheet.stato : 'Non Iniziato';
        const totals = sheet 
          ? calculateTotals(sheet.giorni, daysInMonth)
          : { oreOrd: 0, oreStra: 0, oreFerie: 0, orePerm: 0, ggMalattia: 0, ggTrasferta: 0, ggIntere: 0, ggMezze: 0 };
        const cData = sheet?.collaboratoreData;
        const rim = sheet?.rimborsoSpeseData;
        const totalKm = sheet ? Object.values(sheet.giorni).reduce((sum, g) => sum + (g.kmTrasferta || 0), 0) : 0;
        const totalAltreSpese = rim ? (rim.speseViaggio || 0) + (rim.speseTaxiBus || 0) + (rim.speseParcheggi || 0) + (rim.speseVitto || 0) + (rim.speseAlloggio || 0) + (rim.spesePedaggi || 0) + (rim.speseAltro || 0) : 0;

        return isCollabExport ? [
          dip.nome,
          dip.email || "",
          MESI[selectedMonth - 1],
          selectedYear.toString(),
          status,
          cData ? cData.giornate.toString() : "0",
          cData ? cData.dailyRate.toString() : "0",
          cData ? cData.compensoMensile.toFixed(2) : "0.00",
          cData ? cData.spese.toFixed(2) : "0.00",
          cData ? cData.km.toString() : "0",
          cData ? cData.kmRate.toString() : "0.3",
          cData ? cData.rimborsoKm.toFixed(2) : "0.00",
          cData ? cData.totaleCompenso.toFixed(2) : "0.00",
          cData ? cData.inps.toFixed(2) : "0.00",
          cData ? cData.iva.toFixed(2) : "0.00",
          cData ? cData.ra.toFixed(2) : "0.00",
          cData ? cData.totaleDovuto.toFixed(2) : "0.00"
        ] : [
          dip.nome,
          dip.email || "",
          MESI[selectedMonth - 1],
          selectedYear.toString(),
          status,
          totals.oreOrd.toString(),
          totals.oreStra.toString(),
          totals.oreFerie.toString(),
          totals.orePerm.toString(),
          totals.ggMalattia.toString(),
          totals.ggTrasferta.toString(),
          rim?.marcaAutomezzo || "",
          rim?.modelloAutomezzo || "",
          totalKm.toString(),
          rim?.speseViaggio ? rim.speseViaggio.toFixed(2) : "0.00",
          rim?.speseTaxiBus ? rim.speseTaxiBus.toFixed(2) : "0.00",
          rim?.speseParcheggi ? rim.speseParcheggi.toFixed(2) : "0.00",
          rim?.speseVitto ? rim.speseVitto.toFixed(2) : "0.00",
          rim?.speseAlloggio ? rim.speseAlloggio.toFixed(2) : "0.00",
          rim?.spesePedaggi ? rim.spesePedaggi.toFixed(2) : "0.00",
          rim?.speseAltro ? rim.speseAltro.toFixed(2) : "0.00",
          rim?.altroSpecificare || "",
          totalAltreSpese.toFixed(2)
        ];
      });

      const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map(r => r.map(val => `"${val.replace(/"/g, '""')}"`).join(";"))].join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      const filename = isCollabExport 
        ? `Collaboratori_Mensile_${selectedMonth}_${selectedYear}.csv`
        : `Presenze_Mensile_${selectedMonth}_${selectedYear}.csv`;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Errore durante l'esportazione mensile:", err);
      showToast("Si è verificato un errore durante l'esportazione.", "error");
    }
  };

  const handleExportAnnualExcel = async () => {
    setExportingAnnual(true);
    try {
      const q = query(
        collection(db, 'presenze'),
        where('anno', '==', selectedYear)
      );
      const snapshot = await getDocs(q);
      const annualRapportini: Record<string, RapportinoPresenze> = {};
      snapshot.forEach(docSnap => {
        annualRapportini[docSnap.id] = { id: docSnap.id, ...docSnap.data() } as RapportinoPresenze;
      });

      const isCollabExport = hrTab === 'collaboratori';

      const headers = isCollabExport ? [
        "Collaboratore",
        "Email",
        "Mese",
        "Anno",
        "Stato Rapportino",
        "Giornate Lavorate",
        "Tariffa Giornaliera (€)",
        "Compenso Mensile (€)",
        "Spese (€)",
        "Km Percorsi",
        "Tariffa Km (€/km)",
        "Rimborso Km (€)",
        "Totale Compenso (€)",
        "Cassa INPS (€)",
        "IVA (€)",
        "Ritenuta d'Acconto (€)",
        "Totale Dovuto (€)"
      ] : [
        "Dipendente",
        "Email",
        "Mese",
        "Anno",
        "Stato Rapportino",
        "Ore Ordinarie Lavorate",
        "Ore Straordinari",
        "Ore Ferie",
        "Ore Permessi",
        "Giorni Malattia (M)",
        "Giorni Trasferta (T)",
        "Marca Auto",
        "Modello Auto",
        "Km Totali",
        "Spese Viaggio (€)",
        "Spese Taxi/Bus (€)",
        "Spese Parcheggi (€)",
        "Spese Vitto (€)",
        "Spese Alloggio (€)",
        "Spese Pedaggi (€)",
        "Spese Altro (€)",
        "Dettaglio Altro",
        "Totale Altre Spese (€)"
      ];

      const activeList = filteredDipendenti.filter(dip => {
        const isCollab = isCollaboratore(dip.nome, dipendenti);
        return isCollabExport ? isCollab : !isCollab;
      });

      const rows: string[][] = [];

      activeList.forEach(dip => {
        for (let m = 1; m <= 12; m++) {
          const firstDayOfMStr = `${selectedYear}-${String(m).padStart(2, '0')}-01`;
          if (dip.dataCessazione && dip.dataCessazione < firstDayOfMStr) {
            continue;
          }
          const docId = `${dip.nome}-${selectedYear}-${String(m).padStart(2, '0')}`;
          const sheet = annualRapportini[docId];
          const status = sheet ? sheet.stato : 'Non Iniziato';
          const currentDaysInMonth = new Date(selectedYear, m, 0).getDate();
          const totals = sheet 
            ? calculateTotals(sheet.giorni, currentDaysInMonth)
            : { oreOrd: 0, oreStra: 0, oreFerie: 0, orePerm: 0, ggMalattia: 0, ggTrasferta: 0, ggIntere: 0, ggMezze: 0 };
          const cData = sheet?.collaboratoreData;
          const rim = sheet?.rimborsoSpeseData;
          const totalKm = sheet ? Object.values(sheet.giorni).reduce((sum, g) => sum + (g.kmTrasferta || 0), 0) : 0;
          const totalAltreSpese = rim ? (rim.speseViaggio || 0) + (rim.speseTaxiBus || 0) + (rim.speseParcheggi || 0) + (rim.speseVitto || 0) + (rim.speseAlloggio || 0) + (rim.spesePedaggi || 0) + (rim.speseAltro || 0) : 0;

          rows.push(isCollabExport ? [
            dip.nome,
            dip.email || "",
            MESI[m - 1],
            selectedYear.toString(),
            status,
            cData ? cData.giornate.toString() : "0",
            cData ? cData.dailyRate.toString() : "0",
            cData ? cData.compensoMensile.toFixed(2) : "0.00",
            cData ? cData.spese.toFixed(2) : "0.00",
            cData ? cData.km.toString() : "0",
            cData ? cData.kmRate.toString() : "0.3",
            cData ? cData.rimborsoKm.toFixed(2) : "0.00",
            cData ? cData.totaleCompenso.toFixed(2) : "0.00",
            cData ? cData.inps.toFixed(2) : "0.00",
            cData ? cData.iva.toFixed(2) : "0.00",
            cData ? cData.ra.toFixed(2) : "0.00",
            cData ? cData.totaleDovuto.toFixed(2) : "0.00"
          ] : [
            dip.nome,
            dip.email || "",
            MESI[m - 1],
            selectedYear.toString(),
            status,
            totals.oreOrd.toString(),
            totals.oreStra.toString(),
            totals.oreFerie.toString(),
            totals.orePerm.toString(),
            totals.ggMalattia.toString(),
            totals.ggTrasferta.toString(),
            rim?.marcaAutomezzo || "",
            rim?.modelloAutomezzo || "",
            totalKm.toString(),
            rim?.speseViaggio ? rim.speseViaggio.toFixed(2) : "0.00",
            rim?.speseTaxiBus ? rim.speseTaxiBus.toFixed(2) : "0.00",
            rim?.speseParcheggi ? rim.speseParcheggi.toFixed(2) : "0.00",
            rim?.speseVitto ? rim.speseVitto.toFixed(2) : "0.00",
            rim?.speseAlloggio ? rim.speseAlloggio.toFixed(2) : "0.00",
            rim?.spesePedaggi ? rim.spesePedaggi.toFixed(2) : "0.00",
            rim?.speseAltro ? rim.speseAltro.toFixed(2) : "0.00",
            rim?.altroSpecificare || "",
            totalAltreSpese.toFixed(2)
          ]);
        }
      });

      const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map(r => r.map(val => `"${val.replace(/"/g, '""')}"`).join(";"))].join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      const filename = isCollabExport
        ? `Collaboratori_Annuale_${selectedYear}.csv`
        : `Presenze_Annuale_${selectedYear}.csv`;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Errore durante l'esportazione annuale:", err);
      showToast("Errore durante l'esportazione annuale.", "error");
    } finally {
      setExportingAnnual(false);
    }
  };

  const handleExportMonthlySingle = (dipName: string) => {
    const docId = `${dipName}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
    const sheet = allRapportini[docId];
    if (!sheet) {
      showToast(`Nessun dato presenze registrato per ${dipName} in questo mese.`, "warning");
      return;
    }

    const isCollab = isCollaboratore(dipName, dipendenti);

    if (isCollab) {
      const cData = sheet.collaboratoreData;
      if (!cData) {
        showToast("Dati collaboratore non ancora inizializzati.", "warning");
        return;
      }
      const collabHeaders = ["Parametro", "Valore"];
      const collabRows = [
        ["Mese", MESI[selectedMonth - 1]],
        ["Anno", selectedYear.toString()],
        ["Stato", sheet.stato],
        ["Giornate Lavorate", cData.giornate.toString()],
        ["Tariffa Giornaliera (€)", cData.dailyRate.toString()],
        ["Compenso Mensile (€)", cData.compensoMensile.toFixed(2)],
        ["Spese (€)", cData.spese.toFixed(2)],
        ["Km Percorsi", cData.km.toString()],
        ["Tariffa Km (€/km)", cData.kmRate.toString()],
        ["Rimborso Km (€)", cData.rimborsoKm.toFixed(2)],
        ["Totale Compenso (€)", cData.totaleCompenso.toFixed(2)],
        [`Cassa INPS (${cData.inpsRate}%) (€)`, cData.inps.toFixed(2)],
        [`IVA (${cData.ivaRate}%) (€)`, cData.iva.toFixed(2)],
        [`Ritenuta d'Acconto (${cData.raRate}%) (€)`, cData.ra.toFixed(2)],
        ["Totale Dovuto (€)", cData.totaleDovuto.toFixed(2)]
      ];

      const csvContent = "\uFEFF" + [collabHeaders.join(";"), ...collabRows.map(r => r.map(val => `"${val.replace(/"/g, '""')}"`).join(";"))].join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `Fattura_${dipName.replace(/\s+/g, '_')}_${selectedMonth}_${selectedYear}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    const headers = [
      "Giorno",
      "Data",
      "Stato Giorno",
      "Ore Ordinarie Lavorate",
      "Ore Straordinari",
      "Ferie (Ore)",
      "Permessi (Ore)",
      "Malattia",
      "Trasferta",
      "Rimborso Km",
      "Tratte Spostamento (Partenza -> Arrivo)",
      "Km Percorsi",
      "Note"
    ];

    const rows: string[][] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const g = sheet.giorni[String(d)];
      const formattedDate = `${String(d).padStart(2, '0')}/${String(selectedMonth).padStart(2, '0')}/${selectedYear}`;
      
      let dayStatus = "Lavorativo";
      const dayOfWeek = new Date(selectedYear, selectedMonth - 1, d).getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        dayStatus = "Weekend";
      }

      const tratteList = getTratteForGiorno(g).filter(t => t.partenza || t.arrivo);
      const tratteStr = tratteList.length > 0
        ? tratteList.map((t, idx) => `Tratta ${idx + 1}: ${t.partenza || '?'} -> ${t.arrivo || '?'}`).join(' | ')
        : '';

      rows.push([
        d.toString(),
        formattedDate,
        dayStatus,
        g ? (g.ore || 0).toString() : "0",
        g ? (g.straordinari || 0).toString() : "0",
        g ? (g.ferie || 0).toString() : "0",
        g ? (g.permessi || 0).toString() : "0",
        g && g.malattia ? "M" : "",
        g && g.trasferta ? "T" : "",
        g && g.rimborsoKm ? "K" : "",
        tratteStr,
        g ? (g.kmTrasferta || 0).toString() : "0",
        g ? (g.noteGiorno || "") : ""
      ]);
    }

    const rim = sheet.rimborsoSpeseData;
    const totalKm = Object.values(sheet.giorni).reduce((sum, g) => sum + (g.kmTrasferta || 0), 0);
    const totalAltreSpese = rim ? (rim.speseViaggio || 0) + (rim.speseTaxiBus || 0) + (rim.speseParcheggi || 0) + (rim.speseVitto || 0) + (rim.speseAlloggio || 0) + (rim.spesePedaggi || 0) + (rim.speseAltro || 0) : 0;

    rows.push([]);
    rows.push(["RIEPILOGO NOTA SPESE E TRASFERTE"]);
    rows.push(["Marca Automezzo", rim?.marcaAutomezzo || ""]);
    rows.push(["Modello Automezzo", rim?.modelloAutomezzo || ""]);
    rows.push(["Km Totali Percorsi", totalKm.toString()]);
    rows.push(["Spese Viaggio (€)", rim?.speseViaggio ? rim.speseViaggio.toFixed(2) : "0.00"]);
    rows.push(["Spese Taxi/Bus (€)", rim?.speseTaxiBus ? rim.speseTaxiBus.toFixed(2) : "0.00"]);
    rows.push(["Spese Parcheggi (€)", rim?.speseParcheggi ? rim.speseParcheggi.toFixed(2) : "0.00"]);
    rows.push(["Spese Vitto (€)", rim?.speseVitto ? rim.speseVitto.toFixed(2) : "0.00"]);
    rows.push(["Spese Alloggio (€)", rim?.speseAlloggio ? rim.speseAlloggio.toFixed(2) : "0.00"]);
    rows.push(["Spese Pedaggi (€)", rim?.spesePedaggi ? rim.spesePedaggi.toFixed(2) : "0.00"]);
    rows.push(["Spese Altro (€)", rim?.speseAltro ? rim.speseAltro.toFixed(2) : "0.00"]);
    rows.push(["Dettaglio Altro", rim?.altroSpecificare || ""]);
    rows.push(["Totale Altre Spese (€)", totalAltreSpese.toFixed(2)]);

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map(r => r.map(val => `"${val.replace(/"/g, '""')}"`).join(";"))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Presenze_${dipName.replace(/\s+/g, '_')}_${selectedMonth}_${selectedYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportAnnualSingle = async (dipName: string) => {
    setExportingAnnual(true);
    try {
      const q = query(
        collection(db, 'presenze'),
        where('anno', '==', selectedYear)
      );
      const snapshot = await getDocs(q);
      const annualRapportini: Record<string, RapportinoPresenze> = {};
      snapshot.forEach(docSnap => {
        annualRapportini[docSnap.id] = { id: docSnap.id, ...docSnap.data() } as RapportinoPresenze;
      });

      const isCollab = isCollaboratore(dipName, dipendenti);

      const headers = isCollab ? [
        "Collaboratore",
        "Mese",
        "Anno",
        "Stato Rapportino",
        "Giornate Lavorate",
        "Tariffa Giornaliera (€)",
        "Compenso Mensile (€)",
        "Spese (€)",
        "Km Percorsi",
        "Tariffa Km (€/km)",
        "Rimborso Km (€)",
        "Totale Compenso (€)",
        "Cassa INPS (€)",
        "IVA (€)",
        "Ritenuta d'Acconto (€)",
        "Totale Dovuto (€)"
      ] : [
        "Dipendente",
        "Mese",
        "Anno",
        "Stato Rapportino",
        "Ore Ordinarie Lavorate",
        "Ore Straordinari",
        "Ore Ferie",
        "Ore Permessi",
        "Giorni Malattia (M)",
        "Giorni Trasferta (T)",
        "Marca Auto",
        "Modello Auto",
        "Km Totali",
        "Spese Viaggio (€)",
        "Spese Taxi/Bus (€)",
        "Spese Parcheggi (€)",
        "Spese Vitto (€)",
        "Spese Alloggio (€)",
        "Spese Pedaggi (€)",
        "Spese Altro (€)",
        "Dettaglio Altro",
        "Totale Altre Spese (€)"
      ];

      const rows: string[][] = [];
      for (let m = 1; m <= 12; m++) {
        const docId = `${dipName}-${selectedYear}-${String(m).padStart(2, '0')}`;
        const sheet = annualRapportini[docId];
        const status = sheet ? sheet.stato : 'Non Iniziato';
        const currentDaysInMonth = new Date(selectedYear, m, 0).getDate();
        const totals = sheet 
          ? calculateTotals(sheet.giorni, currentDaysInMonth)
          : { oreOrd: 0, oreStra: 0, oreFerie: 0, orePerm: 0, ggMalattia: 0, ggTrasferta: 0, ggIntere: 0, ggMezze: 0 };
        const cData = sheet?.collaboratoreData;
        const rim = sheet?.rimborsoSpeseData;
        const totalKm = sheet ? Object.values(sheet.giorni).reduce((sum, g) => sum + (g.kmTrasferta || 0), 0) : 0;
        const totalAltreSpese = rim ? (rim.speseViaggio || 0) + (rim.speseTaxiBus || 0) + (rim.speseParcheggi || 0) + (rim.speseVitto || 0) + (rim.speseAlloggio || 0) + (rim.spesePedaggi || 0) + (rim.speseAltro || 0) : 0;

        rows.push(isCollab ? [
          dipName,
          MESI[m - 1],
          selectedYear.toString(),
          status,
          cData ? cData.giornate.toString() : "0",
          cData ? cData.dailyRate.toString() : "0",
          cData ? cData.compensoMensile.toFixed(2) : "0.00",
          cData ? cData.spese.toFixed(2) : "0.00",
          cData ? cData.km.toString() : "0",
          cData ? cData.kmRate.toString() : "0.3",
          cData ? cData.rimborsoKm.toFixed(2) : "0.00",
          cData ? cData.totaleCompenso.toFixed(2) : "0.00",
          cData ? cData.inps.toFixed(2) : "0.00",
          cData ? cData.iva.toFixed(2) : "0.00",
          cData ? cData.ra.toFixed(2) : "0.00",
          cData ? cData.totaleDovuto.toFixed(2) : "0.00"
        ] : [
          dipName,
          MESI[m - 1],
          selectedYear.toString(),
          status,
          totals.oreOrd.toString(),
          totals.oreStra.toString(),
          totals.oreFerie.toString(),
          totals.orePerm.toString(),
          totals.ggMalattia.toString(),
          totals.ggTrasferta.toString(),
          rim?.marcaAutomezzo || "",
          rim?.modelloAutomezzo || "",
          totalKm.toString(),
          rim?.speseViaggio ? rim.speseViaggio.toFixed(2) : "0.00",
          rim?.speseTaxiBus ? rim.speseTaxiBus.toFixed(2) : "0.00",
          rim?.speseParcheggi ? rim.speseParcheggi.toFixed(2) : "0.00",
          rim?.speseVitto ? rim.speseVitto.toFixed(2) : "0.00",
          rim?.speseAlloggio ? rim.speseAlloggio.toFixed(2) : "0.00",
          rim?.spesePedaggi ? rim.spesePedaggi.toFixed(2) : "0.00",
          rim?.speseAltro ? rim.speseAltro.toFixed(2) : "0.00",
          rim?.altroSpecificare || "",
          totalAltreSpese.toFixed(2)
        ]);
      }

      const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map(r => r.map(val => `"${val.replace(/"/g, '""')}"`).join(";"))].join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      const linkName = dipName.replace(/\s+/g, '_');
      link.setAttribute("download", `Presenze_Annuale_${linkName}_${selectedYear}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Errore durante l'esportazione annuale:", err);
      showToast("Errore durante l'esportazione.", "error");
    } finally {
      setExportingAnnual(false);
    }
  };

  const handleExportMonthlyClick = () => {
    if (selectedDipFilter) {
      handleExportMonthlySingle(selectedDipFilter);
    } else {
      handleExportMonthlyExcel();
    }
  };

  const handleExportAnnualClick = () => {
    if (selectedDipFilter) {
      handleExportAnnualSingle(selectedDipFilter);
    } else {
      handleExportAnnualExcel();
    }
  };

  const getDailyNotes = (giorni: { [giorno: string]: GiornoPresenza }, numDays: number) => {
    const notesList: { giorno: number; note: string }[] = [];
    for (let d = 1; d <= numDays; d++) {
      const g = giorni[String(d)];
      if (g && g.noteGiorno && g.noteGiorno.trim() !== '') {
        notesList.push({ giorno: d, note: g.noteGiorno.trim() });
      }
    }
    return notesList;
  };

  const getSheetsToPrint = (): RapportinoPresenze[] => {
    if (printTargetSheet) return [printTargetSheet];
    if (reviewingRapportino) return [reviewingRapportino];
    if (viewMode === 'compila') {
      return rapportino ? [rapportino] : [];
    }
    if (viewMode === 'hr' && selectedDipFilter) {
      const docId = `${selectedDipFilter}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
      const sheet = allRapportini[docId];
      return sheet ? [sheet] : [];
    }
    if (viewMode === 'hr') {
      const filtered = dipendenti.filter(dip => {
        const firstDayOfMonthStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
        if (dip.dataCessazione && dip.dataCessazione < firstDayOfMonthStr) return false;
        const isCollab = isCollaboratore(dip.nome, dipendenti);
        const matchesTab = hrTab === 'collaboratori' ? isCollab : !isCollab;
        return matchesTab;
      });
      const sheets: RapportinoPresenze[] = [];
      filtered.forEach(dip => {
        const docId = `${dip.nome}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
        const sheet = allRapportini[docId];
        if (sheet) {
          sheets.push(sheet);
        }
      });
      return sheets;
    }
    return [];
  };

  const handlePrint = () => {
    const sheets = getSheetsToPrint();
    if (sheets.length === 0) {
      showToast("Nessun documento registrato da stampare per questo mese.", "warning");
      return;
    }
    if (selectedDipFilter) {
      const docId = `${selectedDipFilter}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
      const sheet = allRapportini[docId];
      if (!sheet) {
        showToast(hrTab === 'collaboratori' ? `Nessuna bozza fattura registrata per ${selectedDipFilter} in questo mese.` : `Nessun foglio presenze registrato per ${selectedDipFilter} in questo mese.`, "warning");
        return;
      }
      setPrintTargetSheet(sheet);
      setTimeout(() => {
        window.print();
        setPrintTargetSheet(null);
      }, 150);
    } else {
      window.print();
    }
  };

  // --- RENDER BADGE FOR STATUS ---
  const getStatusBadge = (stato: string) => {
    switch (stato) {
      case 'Approvato':
        return <span className="flex items-center gap-1.5 text-xs font-bold bg-green-100 text-green-700 px-3 py-1 rounded-full"><CheckCircle className="w-3.5 h-3.5"/> Approvato</span>;
      case 'Inviato':
      case 'In attesa':
        return <span className="flex items-center gap-1.5 text-xs font-bold bg-blue-100 text-blue-700 px-3 py-1 rounded-full"><Clock className="w-3.5 h-3.5"/> In attesa</span>;
      case 'Richiede Modifica':
      case 'Richiesta Modifica':
        return <span className="flex items-center gap-1.5 text-xs font-bold bg-orange-100 text-orange-700 px-3 py-1 rounded-full"><AlertCircle className="w-3.5 h-3.5"/> Req. Modifica</span>;
      case 'Richiesta Annullamento':
        return <span className="flex items-center gap-1.5 text-xs font-bold bg-purple-100 text-purple-700 px-3 py-1 rounded-full animate-pulse"><Clock className="w-3.5 h-3.5"/> Req. Annullamento</span>;
      case 'Revocato':
      case 'Rifiutato':
        return <span className="flex items-center gap-1.5 text-xs font-bold bg-rose-100 text-rose-700 px-3 py-1 rounded-full"><X className="w-3.5 h-3.5"/> {stato}</span>;
      case 'Bozza':
        return <span className="flex items-center gap-1.5 text-xs font-bold bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full"><Edit className="w-3.5 h-3.5"/> Bozza</span>;
      default:
        return <span className="flex items-center gap-1.5 text-xs font-bold bg-gray-100 text-gray-500 px-3 py-1 rounded-full"><X className="w-3.5 h-3.5"/> {stato || 'Non Iniziato'}</span>;
    }
  };

  // --- PREPARE DATA FOR SPETTANTI TRASFERTE E RIMBORSI KM ---
  const getTrasferteList = (giorni: { [giorno: string]: GiornoPresenza }, numDays: number) => {
    const list: { giorno: number; luogo: string; trasferta: boolean; rimborsoKm: boolean }[] = [];
    for (let d = 1; d <= numDays; d++) {
      const g = giorni[String(d)];
      if (g && (g.trasferta || g.rimborsoKm || (g.kmTrasferta && g.kmTrasferta > 0) || (g.luogoTrasferta && g.luogoTrasferta.trim() !== ''))) {
        list.push({
          giorno: d,
          luogo: g.luogoTrasferta || '',
          trasferta: !!g.trasferta,
          rimborsoKm: !!g.rimborsoKm
        });
      }
    }
    return list;
  };

  // Calcolo dei conteggi per i badge interni (Dipendenti / Collaboratori) del mese selezionato
  const pendingDipCount = useMemo(() => {
    return filteredDipendenti.filter(dip => {
      const firstDayOfMonthStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
      if (dip.dataCessazione && dip.dataCessazione < firstDayOfMonthStr) return false;
      const isCollab = isCollaboratore(dip.nome, dipendenti);
      if (isCollab) return false;
      const docId = `${dip.nome}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
      const sheet = allRapportini[docId];
      return sheet?.stato === 'Inviato';
    }).length;
  }, [filteredDipendenti, allRapportini, selectedYear, selectedMonth]);

  const pendingCollabCount = useMemo(() => {
    return filteredDipendenti.filter(dip => {
      const firstDayOfMonthStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
      if (dip.dataCessazione && dip.dataCessazione < firstDayOfMonthStr) return false;
      const isCollab = isCollaboratore(dip.nome, dipendenti);
      if (!isCollab) return false;
      const docId = `${dip.nome}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
      const sheet = allRapportini[docId];
      return sheet?.stato === 'Inviato';
    }).length;
  }, [filteredDipendenti, allRapportini, selectedYear, selectedMonth]);

  return (
    <div className="flex flex-col gap-6">
      {/* Contenitore schermate UI - Nascosto in Stampa */}
      <div className="no-print flex flex-col gap-6">
        
        {/* HEADER DELLA PAGINA */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm p-4 sm:p-6 border border-white/50 no-print flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-100 rounded-2xl"><FileText className="text-indigo-600 w-8 h-8" /></div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Registro Presenze</h2>
              <button 
                onClick={loadPresenzeData}
                title="Aggiorna Dati"
                className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 border border-transparent hover:border-indigo-100 rounded-xl transition-all cursor-pointer hover:rotate-180 duration-500"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-500 font-semibold mt-0.5">Gestione foglio ore / bozze fattura e riepilogo mensile per amministrazione</p>
          </div>
        </div>

        {/* SWITCHER COMPILAZIONE / ADMIN SE HR O ADMIN (Nascondi per i soci) */}
        {(isHR || isAdmin) && !isSocio && (
          <div className="flex bg-gray-100/80 p-1.5 rounded-2xl shadow-inner">
            <button 
              onClick={() => { setViewMode('hr'); setReviewingRapportino(null); }}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-1.5 ${viewMode === 'hr' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <span>Dashboard HR</span>
              {isHR && (globalPendingInviatiCount + globalPendingWeekendCount) > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center inline-block">
                  {globalPendingInviatiCount + globalPendingWeekendCount}
                </span>
              )}
            </button>
            <button 
              onClick={() => { setViewMode('compila'); }}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${viewMode === 'compila' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Compila Mio Foglio
            </button>
          </div>
        )}
      </div>

      {/* FILTRI MESE/ANNO */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm p-5 border border-white/50 no-print flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Selettore Mese (Dropdown) */}
          <select 
            value={selectedMonth}
            onChange={e => setSelectedMonth(Number(e.target.value))}
            className="p-2.5 border-none bg-gray-100 rounded-xl font-bold text-gray-700 text-sm outline-none focus:ring-2 focus:ring-indigo-400 capitalize"
          >
            {MESI.map((m, idx) => (
              <option key={idx} value={idx + 1}>{m}</option>
            ))}
          </select>

          {/* Selettore Anno Diretto */}
          <select 
            value={selectedYear}
            onChange={e => setSelectedYear(Number(e.target.value))}
            className="p-2.5 border-none bg-gray-100 rounded-xl font-bold text-gray-700 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
          >
            {(() => {
              const startYear = 2020;
              const currentYearConst = new Date().getFullYear();
              const endYear = currentYearConst + 4;
              const years = [];
              for (let y = startYear; y <= endYear; y++) {
                years.push(y);
              }
              return years.map(yr => (
                <option key={yr} value={yr}>{yr}</option>
              ));
            })()}
          </select>

          {viewMode === 'compila' && myAssociatedName && (
            <div className="flex bg-gray-100 p-1 rounded-xl shadow-inner border border-gray-200/50 flex-wrap gap-1 ml-0 sm:ml-4">
              <button
                type="button"
                onClick={() => setActiveTab('ore')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'ore' ? 'bg-white text-indigo-600 shadow-sm font-extrabold' : 'text-gray-500 hover:text-gray-700'}`}
              >
                📋 {isCollaboratore(myAssociatedName, dipendenti) ? 'Bozza Fattura' : 'Foglio Ore'}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('weekend')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'weekend' ? 'bg-white text-indigo-600 shadow-sm font-extrabold' : 'text-gray-500 hover:text-gray-700'}`}
              >
                🛡️ Weekend/Festività
              </button>
            </div>
          )}

          {/* Selettore Dipendente (Filtro / Esportazione Singolo) */}
          {viewMode === 'hr' && (
            <div className="flex items-center gap-2">
              <select
                value={selectedDipFilter}
                onChange={e => setSelectedDipFilter(e.target.value)}
                className="p-2.5 border-none bg-gray-100 rounded-xl font-bold text-gray-700 text-sm outline-none focus:ring-2 focus:ring-indigo-400 max-w-[200px]"
              >
                <option value="">Tutti i dipendenti</option>
                {filteredDipendenti.filter(d => !d.dataCessazione || d.dataCessazione >= `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`).map(d => (
                  <option key={d.id} value={d.nome}>{d.nome}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {viewMode === 'hr' && (
          <div className="flex gap-2 flex-wrap">
            <button 
              onClick={handlePrint} 
              className="flex items-center gap-2 bg-gray-950 hover:bg-gray-900 text-white font-bold px-4 py-2.5 rounded-xl text-sm transition shadow-md active:scale-95"
            >
              <Printer className="w-4 h-4" /> {selectedDipFilter ? (hrTab === 'collaboratori' ? "Stampa Bozza Fattura" : "Stampa Foglio Ore") : (hrTab === 'collaboratori' ? "Stampa Tutte le Bozze" : "Stampa Tutti i Fogli")}
            </button>
            <button 
              onClick={handleExportMonthlyClick} 
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2.5 rounded-xl text-sm transition shadow-md active:scale-95"
            >
              <Download className="w-4 h-4" /> Esporta Mese (Excel)
            </button>
            <button 
              onClick={handleExportAnnualClick}
              disabled={exportingAnnual}
              className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-bold px-4 py-2.5 rounded-xl text-sm transition shadow-md active:scale-95 disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> {exportingAnnual ? 'Esportazione...' : 'Esporta Anno (Excel)'}
            </button>
          </div>
        )}
      </div>

      {/* ========================================== */}
      {/* 1. MODO HR / ADMIN: DASHBOARD GENERALE      */}
      {/* ========================================== */}
      {viewMode === 'hr' && (
        <>
          {/* TABELLA RICHIESTE WEEKEND / CHIUSURE PENDENTI LATO HR */}
          <div className={`bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-8 border border-white/50 flex flex-col mb-10 overflow-hidden ${(printTargetSheet || reviewingRapportino) ? 'no-print' : ''}`}>
            <h3 className="font-extrabold text-xl text-gray-900 mb-2 flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-indigo-600" />
              <span>Richieste Autorizzazione Weekend / Festività</span>
              {(isHR || isSocio) && globalPendingWeekendCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-extrabold px-2 py-0.5 rounded-full">
                  {globalPendingWeekendCount}
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-500 font-semibold mb-6">
              Elenco delle richieste di dipendenti e collaboratori per lavorare nei giorni di weekend o festività.
            </p>

            <div className="w-full overflow-x-auto">
              {allWeekendRequests.length === 0 ? (
                <p className="text-center text-gray-400 py-6 font-medium italic">Nessuna richiesta di autorizzazione presente.</p>
              ) : (
                <table className="w-full text-left border-collapse min-w-[700px] text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr className="font-bold text-gray-700">
                      <th className="p-3">Dipendente</th>
                      <th className="p-3">Data</th>
                      <th className="p-3">Motivazione</th>
                      <th className="p-3 text-center">Stato</th>
                      <th className="p-3 text-center no-print">Azioni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {allWeekendRequests.map(req => (
                      <tr key={req.id} className="hover:bg-indigo-50/10 transition-colors">
                        <td className="p-3 font-bold text-gray-800">{req.dipendenteName}</td>
                        <td className="p-3 font-bold text-indigo-600">{formatDate(req.data)}</td>
                        <td className="p-3 text-gray-600 max-w-[300px] truncate" title={req.motivo}>{req.motivo}</td>
                        <td className="p-3 text-center align-middle">{getStatusBadge(req.stato)}</td>
                        <td className="p-3 text-center align-middle no-print">
                          {req.stato === 'In attesa' ? (
                            <div className="flex justify-center gap-2">
                              <button 
                                onClick={() => handleWeekendDecision(req.id, 'Approvato')} 
                                className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white font-bold rounded-lg text-[10px] shadow active:scale-95 cursor-pointer"
                              >
                                Approva
                              </button>
                              <button 
                                onClick={() => handleWeekendDecision(req.id, 'Rifiutato')} 
                                className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white font-bold rounded-lg text-[10px] shadow active:scale-95 cursor-pointer"
                              >
                                Rifiuta
                              </button>
                            </div>
                          ) : req.stato === 'Approvato' ? (
                            <button 
                              onClick={() => handleWeekendDecision(req.id, 'Revocato')} 
                              className="px-2.5 py-1 bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 font-bold rounded-lg text-[10px] transition cursor-pointer"
                              title="Revoca l'autorizzazione concessa"
                            >
                              Revoca Autorizzazione
                            </button>
                          ) : req.stato === 'Richiesta Annullamento' ? (
                            <div className="flex justify-center gap-1.5">
                              <button 
                                onClick={() => handleWeekendDecision(req.id, 'Annullato')} 
                                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-[10px] transition cursor-pointer"
                                title="Conferma l'annullamento richiesto dal dipendente"
                              >
                                Conferma Annullamento
                              </button>
                              <button 
                                onClick={() => handleWeekendDecision(req.id, 'Approvato')} 
                                className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg text-[10px] transition cursor-pointer"
                                title="Rigetta l'annullamento e mantieni approvato"
                              >
                                Mantieni Approvato
                              </button>
                            </div>
                          ) : req.stato === 'Richiesta Modifica' ? (
                            <div className="flex justify-center gap-1.5">
                              <button 
                                onClick={() => handleWeekendDecision(req.id, 'Approvato')} 
                                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-[10px] transition cursor-pointer"
                                title="Accetta nuova data o motivo"
                              >
                                Accetta Modifica
                              </button>
                              <button 
                                onClick={() => handleWeekendDecision(req.id, 'Approvato')} 
                                className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg text-[10px] transition cursor-pointer"
                                title="Rifiuta la modifica e mantieni la data originale"
                              >
                                Mantieni Originale
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-gray-400 italic">Nessuna azione</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Form per l'autorizzazione diretta da parte dell'HR */}
            <div className="mt-8 pt-6 border-t border-gray-100 no-print">
              <h4 className="font-bold text-sm text-gray-900 mb-2 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span>Autorizza Direttamente un Dipendente / Collaboratore</span>
              </h4>
              <p className="text-[11px] text-gray-500 mb-4">
                Sblocca direttamente una specifica data di weekend o chiusura aziendale per una risorsa, senza che questa debba inviare una richiesta preventiva.
              </p>
              
              <form onSubmit={handleDirectWeekendAuthSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end bg-gray-50/50 p-4 rounded-2xl border border-gray-100">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 ml-1">Risorsa</label>
                  <select
                    required
                    value={directAuthDipNome}
                    onChange={e => setDirectAuthDipNome(e.target.value)}
                    className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-indigo-400 outline-none text-xs text-gray-750 font-semibold"
                  >
                    <option value="">Seleziona una risorsa...</option>
                    {filteredDipendenti.filter(d => d.nome && (!d.dataCessazione || d.dataCessazione >= new Date().toLocaleDateString('sv-SE'))).map(d => (
                      <option key={d.id} value={d.nome}>{d.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 ml-1">Data da Sbloccare</label>
                  <input
                    required
                    type="date"
                    value={directAuthData}
                    onChange={e => setDirectAuthData(e.target.value)}
                    className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-indigo-400 outline-none text-xs text-gray-750 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 ml-1">Motivazione (Opzionale)</label>
                  <input
                    type="text"
                    placeholder="Es. Lavoro straordinario commessa X"
                    value={directAuthMotivo}
                    onChange={e => setDirectAuthMotivo(e.target.value)}
                    className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-indigo-400 outline-none text-xs text-gray-755 font-semibold"
                  />
                </div>
                <button
                  type="submit"
                  disabled={directAuthLoading}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl transition shadow active:scale-95 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {directAuthLoading ? 'Registrazione...' : 'Concedi Autorizzazione'}
                </button>
              </form>
            </div>
          </div>

          <div className={`bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl border border-white/50 flex flex-col mb-10 overflow-hidden ${(printTargetSheet || reviewingRapportino) ? 'no-print' : ''}`}>
          
          {/* Tabs Dipendenti / Collaboratori */}
          <div className="flex border-b border-gray-100 bg-gray-50/50 px-6 py-4 justify-between items-center gap-4">
            <div className="flex bg-gray-200/60 p-1.5 rounded-2xl">
              <button
                onClick={() => setHrTab('dipendenti')}
                className={`px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${hrTab === 'dipendenti' ? 'bg-white text-indigo-700 shadow-sm font-extrabold' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <span>Dipendenti</span>
                {(isHR || isSocio) && pendingDipCount > 0 && (
                  <span className="bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
                    {pendingDipCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setHrTab('collaboratori')}
                className={`px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${hrTab === 'collaboratori' ? 'bg-white text-indigo-700 shadow-sm font-extrabold' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <span>Collaboratori (P. IVA)</span>
                {(isHR || isSocio) && pendingCollabCount > 0 && (
                  <span className="bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
                    {pendingCollabCount}
                  </span>
                )}
              </button>
            </div>
            <h3 className="font-extrabold text-lg text-gray-900">
              Situazione Presenze - {MESI[selectedMonth - 1]} {selectedYear}
            </h3>
          </div>

          <div className="w-full overflow-x-auto">
            {loadingHR ? (
              <div className="p-12 text-center text-gray-500 font-bold">Caricamento in corso...</div>
            ) : filteredDipendenti.length === 0 ? (
              <div className="p-12 text-center text-gray-400 font-medium">Nessun utente censito in anagrafica.</div>
            ) : (
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead className="bg-gray-50 border-b border-gray-100">
                  {hrTab === 'dipendenti' ? (
                    <tr>
                      <th className="p-4 font-bold text-gray-700 text-sm">Dipendente</th>
                      <th className="p-4 font-bold text-gray-700 text-sm text-center">Stato</th>
                      <th className="p-4 font-bold text-gray-700 text-sm text-right">Ore Ordinarie</th>
                      <th className="p-4 font-bold text-gray-700 text-sm text-right">Straordinari</th>
                      <th className="p-4 font-bold text-gray-700 text-sm text-right">Ferie / Mal.</th>
                      <th className="p-4 font-bold text-gray-700 text-sm text-right">Permessi</th>
                      <th className="p-4 font-bold text-gray-700 text-sm text-center">Malattia/Maternità</th>
                      <th className="p-4 font-bold text-gray-700 text-sm text-center">Trasferte (Giorni)</th>
                      <th className="p-4 font-bold text-gray-700 text-sm text-center no-print">Azione</th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="p-4 font-bold text-gray-700 text-sm">Collaboratore</th>
                      <th className="p-4 font-bold text-gray-700 text-sm text-center">Stato</th>
                      <th className="p-4 font-bold text-gray-700 text-sm text-right">Giornate Lavorate</th>
                      <th className="p-4 font-bold text-gray-700 text-sm text-right">Spese</th>
                      <th className="p-4 font-bold text-gray-700 text-sm text-right">Rimborso Km</th>
                      <th className="p-4 font-bold text-gray-700 text-sm text-right">Totale Dovuto</th>
                      <th className="p-4 font-bold text-gray-700 text-sm text-center no-print">Azione</th>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredDipendenti
                    .filter(dip => {
                      const firstDayOfMonthStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
                      if (dip.dataCessazione && dip.dataCessazione < firstDayOfMonthStr) return false;

                      const isCollab = isCollaboratore(dip.nome, dipendenti);
                      const matchesTab = hrTab === 'collaboratori' ? isCollab : !isCollab;
                      const matchesSearch = !selectedDipFilter || dip.nome === selectedDipFilter;
                      return matchesTab && matchesSearch;
                    })
                    .map(dip => {
                      const docId = `${dip.nome}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
                      const sheet = allRapportini[docId];
                      const status = sheet ? sheet.stato : 'Non Iniziato';
                      
                      const totals = sheet 
                        ? calculateTotals(sheet.giorni, daysInMonth)
                        : { oreOrd: 0, oreStra: 0, oreFerie: 0, orePerm: 0, ggMalattia: 0, oreMalattia: 0, ggTrasferta: 0, ggIntere: 0, ggMezze: 0 };

                      return (
                        <tr key={dip.id} className="hover:bg-indigo-50/20 transition-colors">
                          <td className="p-4">
                            <div className="font-bold text-gray-800">{dip.nome}</div>
                            <div className="text-xs text-gray-500">{dip.email || 'Nessuna email'}</div>
                          </td>
                          <td className="p-4 text-center align-middle">
                            <div className="flex justify-center">{getStatusBadge(status)}</div>
                          </td>
                          {hrTab === 'dipendenti' ? (
                            <>
                              <td className="p-4 text-right font-semibold text-gray-700">{formatDec(totals.oreOrd)}h</td>
                              <td className="p-4 text-right font-bold text-amber-600">{totals.oreStra > 0 ? `+${formatDec(totals.oreStra)}h` : '0h'}</td>
                              <td className="p-4 text-right font-semibold text-gray-700">{formatDec(totals.oreFerie)}h</td>
                              <td className="p-4 text-right font-semibold text-gray-700">{formatDec(totals.orePerm)}h</td>
                              <td className="p-4 text-center text-red-600 font-bold">{totals.oreMalattia > 0 ? `${formatDec(totals.oreMalattia)}h` : '-'}</td>
                              <td className="p-4 text-center text-blue-600 font-bold">{totals.ggTrasferta > 0 ? formatDec(totals.ggTrasferta) : '-'}</td>
                            </>
                          ) : (
                            <>
                              <td className="p-4 text-right font-semibold text-gray-700">
                                {sheet?.collaboratoreData ? `${formatDec(sheet.collaboratoreData.giornate)} gg` : '-'}
                              </td>
                              <td className="p-4 text-right font-semibold text-gray-700">
                                {sheet?.collaboratoreData ? `${formatDec(sheet.collaboratoreData.spese.toFixed(2))} €` : '-'}
                              </td>
                              <td className="p-4 text-right font-semibold text-gray-700">
                                {sheet?.collaboratoreData ? `${formatDec(sheet.collaboratoreData.rimborsoKm.toFixed(2))} €` : '-'}
                              </td>
                              <td className="p-4 text-right font-bold text-indigo-600">
                                {sheet?.collaboratoreData ? `${formatDec(sheet.collaboratoreData.totaleDovuto.toFixed(2))} €` : '-'}
                              </td>
                            </>
                          )}
                          <td className="p-4 text-center no-print">
                            {sheet ? (
                              <div className="flex items-center justify-center gap-2">
                                <button 
                                  onClick={() => {
                                    setReviewingRapportino(JSON.parse(JSON.stringify(sheet))); // clone object
                                  }}
                                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition active:scale-95 cursor-pointer"
                                >
                                  Esamina
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPrintTargetSheet(sheet);
                                    setTimeout(() => {
                                      window.print();
                                      setPrintTargetSheet(null);
                                    }, 150);
                                  }}
                                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs rounded-xl border border-slate-300 transition active:scale-95 flex items-center gap-1 cursor-pointer shadow-2xs"
                                  title={hrTab === 'collaboratori' ? "Stampa unicamente la bozza fattura di questo collaboratore" : "Stampa unicamente il foglio ore di questo dipendente"}
                                >
                                  <Printer className="w-3.5 h-3.5 text-slate-600" />
                                  <span className="hidden xl:inline">Stampa</span>
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400 font-medium italic">Nessun dato</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        </div>


        </>
      )}

      {/* ========================================== */}
      {/* 2. MODO DIPENDENTE: COMPILAZIONE FOGLIO ORE */}
      {/* ========================================== */}
      {viewMode === 'compila' && (
        <div className="flex flex-col gap-6">
          
          {/* STATO E NOTIFICHE DEL RAPPORTINO */}
          {loadingSheet ? (
            <div className="bg-white p-10 rounded-[2rem] border text-center text-gray-500 font-bold">Caricamento in corso...</div>
          ) : !myAssociatedName ? (
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 p-8 rounded-[2rem] text-center flex flex-col items-center gap-4">
              <ShieldAlert className="w-12 h-12 text-amber-600" />
              <div>
                <h4 className="font-extrabold text-xl text-amber-950">Profilo non collegato</h4>
                <p className="text-sm text-amber-900/80 mt-2 max-w-md mx-auto">
                  Il tuo indirizzo email corrente non corrisponde a nessun dipendente in anagrafica. 
                  Contatta un Amministratore nelle impostazioni per collegare la tua mail al tuo profilo dipendente.
                </p>
              </div>
            </div>
          ) : !rapportino ? (
            <div className="bg-white p-10 rounded-[2rem] border text-center text-gray-500 font-bold">Inizializzazione modulo in corso...</div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* Box Ore Contratto (solo per Dipendenti Standard, no P.IVA/Collaboratori) */}
              {!isCollaboratore(myAssociatedName, dipendenti) && (
                <div className="bg-white/90 backdrop-blur-md p-6 rounded-[2rem] border border-gray-200 flex flex-col lg:flex-row lg:items-center justify-between gap-6 shadow-sm no-print">
                  <div className="space-y-1">
                    <h4 className="font-extrabold text-gray-900 flex items-center gap-2">
                      <Clock className="w-5 h-5 text-indigo-600" />
                      Ore da Contratto
                    </h4>
                    <p className="text-xs text-gray-500 font-semibold leading-relaxed">
                      Imposta le tue ore settimanali da contratto. Puoi indicare una decorrenza per i cambi contratto a metà mese.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 bg-gray-50 p-3 rounded-2xl border border-gray-100">
                    <div className="flex items-center gap-3 flex-wrap">
                      {['lun', 'mar', 'mer', 'gio', 'ven'].map(day => (
                        <div key={day} className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-gray-500 uppercase">{day}</span>
                          <input 
                            type="number"
                            step="any"
                            min={0}
                            max={24}
                            value={localOrarioSettimanale[day] ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? '' : Number(e.target.value);
                              setLocalOrarioSettimanale(prev => ({ ...prev, [day]: val }));
                            }}
                            className="w-12 text-center border border-gray-300 rounded-xl p-1 font-bold outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white text-xs"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg shrink-0">
                      Tot: {Object.values(localOrarioSettimanale).reduce((a: number, b) => a + (b === '' ? 0 : (b as number)), 0)}h/sett
                    </div>

                    <div className="w-[1px] h-6 bg-gray-200" />

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Decorrenza dal giorno:</span>
                      <select 
                        value={decorrenzaGiorno}
                        onChange={(e) => setDecorrenzaGiorno(Number(e.target.value))}
                        className="border border-gray-300 rounded-xl p-1.5 font-bold outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white text-xs"
                      >
                        {Array.from({ length: 31 }).map((_, idx) => (
                          <option key={idx + 1} value={idx + 1}>{idx + 1}</option>
                        ))}
                      </select>
                    </div>

                    <div className="w-[1px] h-6 bg-gray-200" />

                    <button
                      type="button"
                      onClick={async () => {
                        if (profile) {
                          try {
                            const newOrario = {
                              lun: localOrarioSettimanale.lun === '' ? 0 : localOrarioSettimanale.lun,
                              mar: localOrarioSettimanale.mar === '' ? 0 : localOrarioSettimanale.mar,
                              mer: localOrarioSettimanale.mer === '' ? 0 : localOrarioSettimanale.mer,
                              gio: localOrarioSettimanale.gio === '' ? 0 : localOrarioSettimanale.gio,
                              ven: localOrarioSettimanale.ven === '' ? 0 : localOrarioSettimanale.ven,
                            };
                            const totalWeeklyHours = Object.values(newOrario).reduce((a, b) => a + b, 0);
                            const avgDailyHours = totalWeeklyHours / 5;
                            const oldContractHours = profile.oreContratto ?? 8;
                            
                            // 1. Aggiorna anagrafica dipendente
                            await updateDoc(doc(db, 'dipendenti', profile.id), {
                              orarioSettimanale: newOrario,
                              oreContratto: avgDailyHours
                            });

                            // 2. Se c'è un rapportino correntemente caricato ed è modificabile, aggiorna le ore della tabella a partire dalla data di decorrenza
                            if (rapportino && (rapportino.stato === 'Bozza' || rapportino.stato === 'Richiede Modifica')) {
                              const updatedGiorni = { ...rapportino.giorni };
                              let changed = false;

                              for (let d = 1; d <= 31; d++) {
                                const dayKey = String(d);
                                const g = updatedGiorni[dayKey];
                                if (g) {
                                  const appliesToThisDay = d >= decorrenzaGiorno;

                                  if (appliesToThisDay) {
                                    const dateObj = new Date(selectedYear, selectedMonth - 1, d);
                                    const dayOfWeek = dateObj.getDay();
                                    const weekdayKeys = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
                                    const key = weekdayKeys[dayOfWeek];
                                    const isWknd = dayOfWeek === 0 || dayOfWeek === 6;
                                    
                                    const val = isWknd ? 0 : (newOrario[key as keyof typeof newOrario] ?? 8);
                                    
                                    let dayChanged = false;
                                    const oldDayContractHours = g.oreContratto ?? oldContractHours;
                                    g.oreContratto = val;

                                    // Aggiorna giornate intere di ferie
                                    if (g.ferie === oldDayContractHours) {
                                      g.ferie = val;
                                      dayChanged = true;
                                    }

                                    // Aggiorna giornate intere lavorate
                                    if (g.ore === oldDayContractHours) {
                                      g.ore = val;
                                      dayChanged = true;
                                    } else if (g.permessi > 0 || g.ferie > 0) {
                                      // Ricalcola bilanciamento per giornate parziali
                                      const oldOre = g.ore;
                                      g.ore = Math.max(0, val - (g.ferie || 0) - (g.permessi || 0));
                                      if (g.ore !== oldOre) {
                                        dayChanged = true;
                                      }
                                    }

                                    if (dayChanged || g.oreContratto !== oldDayContractHours) {
                                      changed = true;
                                    }
                                  }
                                }
                              }

                              if (changed) {
                                const updatedRapportino = {
                                  ...rapportino,
                                  giorni: updatedGiorni,
                                  timestamp: new Date().toISOString()
                                };
                                await setDoc(doc(db, 'presenze', rapportino.id), updatedRapportino);
                                setRapportino(updatedRapportino);
                              }
                            }

                            await refreshData();
                            showToast("Ore da contratto aggiornate con successo!", "success");
                          } catch (err) {
                            console.error("Errore aggiornamento ore contratto:", err);
                            showToast("Errore durante il salvataggio.", "error");
                          }
                        }
                      }}
                      className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-sm hover:shadow active:scale-95 transition-all"
                    >
                      Applica
                    </button>
                  </div>
                </div>
              )}
              
              {/* Box Stato */}
              <div className="bg-white/90 backdrop-blur-md p-6 rounded-[2rem] border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-sm no-print">
                <div className="space-y-1">
                  <div className="text-xs text-gray-500 font-bold uppercase tracking-wider">Mese in corso di visualizzazione</div>
                  <h3 className="font-extrabold text-xl text-gray-800 capitalize">{MESI[selectedMonth - 1]} {selectedYear} - {myAssociatedName}</h3>
                </div>
                
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-gray-600">Stato:</span>
                  {getStatusBadge(rapportino.stato)}
                </div>
              </div>

              {/* Box Feedback HR se richiesto */}
              {rapportino.stato === 'Richiede Modifica' && (
                <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 p-5 rounded-2xl flex items-start gap-3 shadow-inner no-print animate-pulse">
                  <MessageSquare className="w-6 h-6 text-orange-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-extrabold text-sm text-orange-950">Correzione richiesta da HR:</h4>
                    <p className="text-sm text-orange-900/90 font-medium mt-1 italic">"{rapportino.noteHR}"</p>
                  </div>
                </div>
              )}

              {activeTab === 'weekend' ? (
                <div className="bg-gradient-to-br from-indigo-50 to-blue-50 p-6 rounded-3xl border border-indigo-100 shadow-sm no-print animate-in fade-in slide-in-from-bottom-4 duration-350">
                  <h3 className="font-extrabold text-xl mb-4 text-indigo-950 flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-indigo-600" />
                    Autorizzazione Lavoro Weekend e Festività
                  </h3>
                  <p className="text-xs text-indigo-900/80 mb-5 leading-relaxed">
                    Per poter registrare ore di lavoro il sabato, la domenica o nei giorni festivi, devi inviare una richiesta preventiva all'HR <strong>entro la mezzanotte del giorno precedente</strong> (almeno 1 giorno di anticipo). Una volta approvata, i giorni corrispondenti saranno sbloccati nel tuo tabellone presenze.
                  </p>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Form */}
                    <form onSubmit={handleRequestWeekendSubmit} className="space-y-4 bg-white/60 p-5 rounded-2xl border border-indigo-100">
                      <h4 className="text-sm font-bold text-indigo-900">Invia Nuova Richiesta</h4>
                      <div>
                        <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Giorno (con almeno 1 giorno di anticipo)</label>
                        <input 
                          type="date"
                          required
                          min={(() => {
                            const d = new Date();
                            d.setDate(d.getDate() + 1);
                            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                          })()}
                          value={reqWeekendData}
                          onChange={e => setReqWeekendData(e.target.value)}
                          className="w-full p-2.5 border-none bg-white rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Motivazione</label>
                        <textarea
                          required
                          rows={2}
                          value={reqWeekendMotivo}
                          onChange={e => setReqWeekendMotivo(e.target.value)}
                          placeholder="Es. Straordinari urgenti commessa GSK, trasferta cliente..."
                          className="w-full p-2.5 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                        />
                      </div>
                      <button 
                        type="submit"
                        disabled={reqWeekendLoading}
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow transition active:scale-95 disabled:opacity-50"
                      >
                        {reqWeekendLoading ? 'Invio in corso...' : 'Invia Richiesta'}
                      </button>
                    </form>

                    {/* Storico Richieste Utente */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-bold text-indigo-900">Storico delle tue Richieste</h4>
                      <div className="max-h-[220px] overflow-y-auto pr-1 space-y-2.5 custom-scrollbar">
                        {myWeekendRequests.length === 0 ? (
                          <p className="text-xs text-gray-400 italic p-2 bg-white/30 rounded-xl">Nessuna richiesta inviata.</p>
                        ) : (
                          myWeekendRequests.map(req => (
                            <div key={req.id} className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm flex justify-between items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold text-gray-900 flex items-center gap-2">
                                  <span>{formatDate(req.data)}</span>
                                  {req.nuovaData && (
                                    <span className="text-[10px] text-indigo-600 font-extrabold">(Richiesta sposta a {formatDate(req.nuovaData)})</span>
                                  )}
                                </div>
                                <div className="text-[10px] text-gray-500 truncate" title={req.motivo}>{req.motivo}</div>
                                {req.noteModifica && (
                                  <div className="text-[9px] text-purple-700 font-semibold italic truncate">Nota: {req.noteModifica}</div>
                                )}
                              </div>
                              <div className="shrink-0 flex items-center gap-2">
                                {getStatusBadge(req.stato)}
                                {req.stato === 'In attesa' && (
                                  <button
                                    type="button"
                                    onClick={() => handleCancelPendingWeekendRequest(req.id)}
                                    className="p-1 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition cursor-pointer"
                                    title="Elimina richiesta in attesa"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {req.stato === 'Approvato' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setModifyingWeekendReq(req);
                                      setModWeekendTipo('annullamento');
                                      setModWeekendMotivo('');
                                      setModWeekendNuovaData('');
                                    }}
                                    className="px-2 py-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition cursor-pointer flex items-center gap-1"
                                    title="Richiedi modifica o annullamento all'HR"
                                  >
                                    <Edit3 className="w-3 h-3" /> Modifica / Annulla
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : isCollaboratore(myAssociatedName, dipendenti) ? (
                // COLLABORATOR VIEW
                <>
                  {/* Digital invoice draft block */}
                  <div className="bg-white rounded-[2rem] shadow-xl border overflow-hidden p-6 sm:p-8 space-y-6">
                    <div className="flex justify-between items-center border-b pb-4">
                      <div>
                        <h4 className="font-extrabold text-lg text-gray-900">Bozza Fattura Collaboratore</h4>
                        <p className="text-xs text-gray-500 font-semibold">Compila i dati del mese per calcolare il totale compenso e le imposte.</p>
                      </div>
                      <button onClick={() => window.print()} className="flex items-center gap-1.5 text-gray-700 hover:text-gray-900 font-extrabold text-xs bg-white border px-3 py-1.5 rounded-xl shadow-sm hover:shadow active:scale-95 transition-all no-print">
                        <Printer className="w-3.5 h-3.5" /> Stampa Mia Fattura
                      </button>
                    </div>

                    {rapportino.collaboratoreData ? (
                      <div className="w-full overflow-x-auto scrollbar-thin">
                        <table className="w-full text-left border-collapse min-w-[700px] text-xs">
                          <thead>
                            <tr className="bg-gray-100 border-b border-gray-200 uppercase font-bold text-gray-655 text-[10px]">
                              <th className="p-3 w-1/3">Voce / Descrizione</th>
                              <th className="p-3 w-1/3 text-right">Aliquota / Parametro</th>
                              <th className="p-3 w-1/3 text-right">Importo (€)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 font-medium text-gray-700">
                            {/* COMPENSO MENSILE */}
                            {/* COMPENSO MENSILE */}
                            {rapportino.collaboratoreData.importoFissoMensile && Number(rapportino.collaboratoreData.importoFissoMensile) > 0 ? (
                              <tr className="bg-blue-50/30">
                                <td className="p-3 font-semibold text-blue-900">
                                  Compenso Mensile Fisso
                                  <span className="ml-1 text-[9px] text-blue-500 font-normal">(accordo a canone fisso · modificabile)</span>
                                </td>
                                <td className="p-3 text-right">
                                  <input 
                                    type="number"
                                    step="any"
                                    min="0"
                                    disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                    value={rapportino.collaboratoreData.importoFissoMensile}
                                    onChange={e => handleCollabFieldChange('importoFissoMensile', Number(e.target.value))}
                                    className="w-24 p-1.5 text-xs text-right border rounded bg-white font-bold outline-none focus:border-blue-400"
                                  /> €
                                </td>
                                <td className="p-3 text-right font-semibold text-blue-900">
                                  {formatDec((Number(rapportino.collaboratoreData.importoFissoMensile)).toFixed(2))} €
                                </td>
                              </tr>
                            ) : (
                              <>
                                <tr>
                                  <td className="p-3 font-semibold">
                                    Giornate Lavorate
                                    <span className="ml-1 text-[9px] text-gray-400 font-normal">(calcolate auto · modificabili)</span>
                                  </td>
                                  <td className="p-3 text-right">
                                    <input 
                                      type="number"
                                      step="0.5"
                                      min="0"
                                      disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                      value={rapportino.collaboratoreData.giornateOverride ?? rapportino.collaboratoreData.giornate}
                                      onChange={e => handleCollabFieldChange('giornateOverride', Number(e.target.value))}
                                      className="w-24 p-1.5 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                                    />
                                  </td>
                                  <td className="p-3 text-right">-</td>
                                </tr>
                                <tr>
                                  <td className="p-3 font-semibold">Compenso Giornaliero (Contratto)</td>
                                  <td className="p-3 text-right">
                                    <input 
                                      type="number"
                                      step="any"
                                      min="0"
                                      disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                      value={rapportino.collaboratoreData.dailyRate}
                                      onChange={e => handleCollabFieldChange('dailyRate', Number(e.target.value))}
                                      className="w-24 p-1.5 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                                    /> €/gg
                                  </td>
                                  <td className="p-3 text-right">-</td>
                                </tr>
                                <tr className="bg-amber-50/20 font-bold">
                                  <td className="p-3">Compenso Mensile (Giornate × Tariffa)</td>
                                  <td className="p-3 text-right">-</td>
                                  <td className="p-3 text-right text-gray-900">{formatDec(rapportino.collaboratoreData.compensoMensile.toFixed(2))} €</td>
                                </tr>
                              </>
                            )}

                            {/* SPESE & KM */}
                            <tr>
                              <td className="p-3 font-semibold">Spese (Vitto, alloggio, ecc.)</td>
                              <td className="p-3 text-right">
                                <input 
                                  type="number"
                                  step="any"
                                  min="0"
                                  disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                  value={rapportino.collaboratoreData.spese}
                                  onChange={e => handleCollabFieldChange('spese', Number(e.target.value))}
                                  className="w-24 p-1.5 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                                />
                              </td>
                              <td className="p-3 text-right text-gray-900">{formatDec(rapportino.collaboratoreData.spese.toFixed(2))} €</td>
                            </tr>
                            <tr>
                              <td className="p-3 font-semibold">Chilometri Percorsi</td>
                              <td className="p-3 text-right">
                                <input 
                                  type="number"
                                  step="any"
                                  min="0"
                                  disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                  value={rapportino.collaboratoreData.km}
                                  onChange={e => handleCollabFieldChange('km', Number(e.target.value))}
                                  className="w-24 p-1.5 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                                />
                              </td>
                              <td className="p-3 text-right">-</td>
                            </tr>
                            <tr>
                              <td className="p-3 font-semibold">Tariffa Chilometrica (€/km)</td>
                              <td className="p-3 text-right">
                                <input 
                                  type="number"
                                  step="any"
                                  min="0"
                                  disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                  value={rapportino.collaboratoreData.kmRate}
                                  onChange={e => handleCollabFieldChange('kmRate', Number(e.target.value))}
                                  className="w-24 p-1.5 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                                />
                              </td>
                              <td className="p-3 text-right">-</td>
                            </tr>
                            <tr className="bg-amber-50/20 font-bold">
                              <td className="p-3">Rimborso Chilometricico (Km × Tariffa)</td>
                              <td className="p-3 text-right">-</td>
                              <td className="p-3 text-right text-gray-900">{formatDec(rapportino.collaboratoreData.rimborsoKm.toFixed(2))} €</td>
                            </tr>

                            {/* TOTAL COMPENSO */}
                            <tr className="bg-amber-100/30 text-sm font-extrabold border-y border-amber-200">
                              <td className="p-3 uppercase">Totale Compenso (Imponibile)</td>
                              <td className="p-3 text-right">-</td>
                              <td className="p-3 text-right text-amber-900">{formatDec(rapportino.collaboratoreData.totaleCompenso.toFixed(2))} €</td>
                            </tr>

                            {/* TAX RATES */}
                            <tr>
                              <td className="p-3 font-semibold">
                                <input
                                  type="text"
                                  placeholder="Contributo cassa previdenziale"
                                  disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                  value={rapportino.collaboratoreData.cassaLabel ?? 'Contributo cassa previdenziale'}
                                  onChange={e => handleCollabFieldChange('cassaLabel', e.target.value)}
                                  className="!px-0 !mx-0 !text-left border-b border-dashed border-gray-300 bg-transparent outline-none font-semibold text-xs text-gray-700 w-full focus:border-amber-400"
                                />
                                <span className="text-[9px] text-gray-400 block mt-0.5">(es. INPS, Inarcassa, Cassa Geometri - clicca per modificare)</span>
                              </td>
                              <td className="p-3 text-right">
                                <input 
                                  type="number"
                                  step="any"
                                  min="0"
                                  disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                  value={rapportino.collaboratoreData.inpsRate}
                                  onChange={e => handleCollabFieldChange('inpsRate', Number(e.target.value))}
                                  className="w-24 p-1.5 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                                /> %
                              </td>
                              <td className="p-3 text-right text-gray-900">{formatDec(rapportino.collaboratoreData.inps.toFixed(2))} €</td>
                            </tr>
                            <tr>
                              <td className="p-3 font-semibold">IVA</td>
                              <td className="p-3 text-right">
                                <input 
                                  type="number"
                                  step="any"
                                  min="0"
                                  disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                  value={rapportino.collaboratoreData.ivaRate}
                                  onChange={e => handleCollabFieldChange('ivaRate', Number(e.target.value))}
                                  className="w-24 p-1.5 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                                /> %
                              </td>
                              <td className="p-3 text-right text-gray-900">{formatDec(rapportino.collaboratoreData.iva.toFixed(2))} €</td>
                            </tr>
                            <tr>
                              <td className="p-3 font-semibold">Ritenuta d'Acconto</td>
                              <td className="p-3 text-right">
                                <input 
                                  type="number"
                                  step="any"
                                  min="0"
                                  disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                  value={rapportino.collaboratoreData.raRate}
                                  onChange={e => handleCollabFieldChange('raRate', Number(e.target.value))}
                                  className="w-24 p-1.5 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                                /> %
                              </td>
                              <td className="p-3 text-right text-red-655">- {formatDec(rapportino.collaboratoreData.ra.toFixed(2))} €</td>
                            </tr>

                            {/* TOTAL DUE */}
                            <tr className="bg-amber-600/10 text-base font-black border-t-2 border-amber-600">
                              <td className="p-4 uppercase text-amber-950">TOTALE DOVUTO (A PAGARE)</td>
                              <td className="p-4 text-right">-</td>
                              <td className="p-4 text-right text-amber-900 text-lg font-black">{formatDec(rapportino.collaboratoreData.totaleDovuto.toFixed(2))} €</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-gray-500 italic">Inizializzazione dati calcolo...</p>
                    )}

                    {/* Note Collaboratore */}
                    <div className="space-y-2 pt-4 border-t">
                      <label className="block text-sm font-extrabold text-gray-800">
                        Note e Dettagli Aggiuntivi
                      </label>
                      <textarea
                        rows={3}
                        placeholder="Inserisci qui eventuali note o commenti per la fattura..."
                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                        value={rapportino.noteDipendente || ''}
                        onChange={e => setRapportino({ ...rapportino, noteDipendente: e.target.value })}
                        className="w-full mt-2 p-3 text-xs border rounded-xl bg-white outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 font-medium"
                      />
                    </div>
                  </div>

                  {/* ACTION BUTTONS */}
                  {(rapportino.stato === 'Bozza' || rapportino.stato === 'Richiede Modifica') && (
                    <div className="flex justify-end gap-3 no-print">
                      <button 
                        onClick={handleSaveDraft}
                        disabled={saving || submitting}
                        className="flex items-center gap-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-extrabold px-6 py-3.5 rounded-xl transition shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
                      >
                        <Save className="w-4 h-4" />
                        {saving ? 'Salvataggio...' : 'Salva Bozza'}
                      </button>
                      <button 
                        onClick={handleSubmitToHR}
                        disabled={saving || submitting}
                        className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold px-7 py-3.5 rounded-xl transition shadow-lg active:scale-95 disabled:opacity-50 cursor-pointer"
                      >
                        <Send className="w-4 h-4" />
                        {submitting ? 'Invio in corso...' : 'Invia a HR'}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                // STANDARD EMPLOYEE FORM
                <>
                  {activeTab === 'ore' && (
                    <>
                      {/* TABELLA REGISTRO PRESENZE (giorni 1-31) */}
                      <div className="bg-white rounded-[2rem] shadow-xl border overflow-hidden relative">
                
                {/* Legenda rapida */}
                <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex flex-wrap gap-4 items-center justify-between no-print">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-extrabold text-gray-400 uppercase tracking-wider mr-2">Legenda:</span>
                    <span className="flex items-center gap-1.5 text-xs font-bold text-gray-700 bg-white px-2.5 py-1 rounded-lg border shadow-sm"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Ore Ordinarie</span>
                    <span className="flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-white px-2.5 py-1 rounded-lg border shadow-sm"><span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Straordinari</span>
                    <span className="flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-white px-2.5 py-1 rounded-lg border shadow-sm"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Trasferta (T)</span>
                    <span className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100 shadow-sm">ℹ️ Ferie, Permessi e Malattie sono sincronizzati dal Piano Ferie</span>
                  </div>
                  
                  <button onClick={() => window.print()} className="flex items-center gap-1.5 text-gray-700 hover:text-gray-900 font-extrabold text-xs bg-white border px-3 py-1.5 rounded-xl shadow-sm hover:shadow active:scale-95 transition-all">
                    <Printer className="w-3.5 h-3.5" /> Stampa Mio Foglio
                  </button>
                </div>

                {/* Griglia Fissa 1-31 */}
                <div className="w-full overflow-x-auto scrollbar-thin">
                  <table className="w-full text-center border-collapse min-w-[1200px] text-xs">
                    <thead>
                      <tr className="bg-gray-100 border-b border-gray-200 text-[10px] uppercase font-bold text-gray-600 h-10">
                        <th className="p-2 text-left w-36 font-extrabold text-gray-700 bg-gray-100 sticky left-0 z-10 border-r border-gray-200 h-10 align-middle">Giorno</th>
                        {Array.from({ length: 31 }).map((_, i) => {
                          const dayNum = i + 1;
                          const outOfMonth = dayNum > daysInMonth;
                          const dayStyle = getCellDayStyle(dayNum);

                          return (
                            <th 
                              key={i} 
                              style={dayStyle.style}
                              className={`p-1 border-r border-gray-200 w-[2.8%] min-w-[34px] h-10 align-middle ${outOfMonth ? 'bg-gray-300/50 text-gray-400' : dayStyle.className || 'text-gray-700'}`}
                            >
                              <div>{dayNum}</div>
                              {!outOfMonth && (
                                <div className="text-[8px] opacity-60 font-semibold">
                                  {new Date(selectedYear, selectedMonth - 1, dayNum).toLocaleDateString('it-IT', { weekday: 'narrow' })}
                                </div>
                              )}
                            </th>
                          );
                        })}
                        <th className="p-2 font-extrabold text-gray-800 bg-gray-150 border-l-2 border-gray-300 w-16 h-10 align-middle">TOT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 font-medium">
                      {isCollaboratore(myAssociatedName, dipendenti) ? (
                        <>
                          {/* COLLABORATORI RIGA 1: GIORNATA INTERA */}
                          <tr className="hover:bg-gray-50/50 transition-colors h-10">
                            <td className="px-3 py-2 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 whitespace-nowrap h-10 align-middle">Giornata Intera</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-0 border-r border-gray-200 h-10 align-middle text-center ${outOfMonth ? 'bg-gray-200/30' : dayStyle.className || ''}`}>
                                  {!outOfMonth && giorno && (
                                    <div className="w-full h-full flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato' || isCellDisabled(d, 'lavoro')}
                                        checked={giorno.ore === 8}
                                        onChange={e => {
                                          const val = e.target.checked ? 8 : 0;
                                          handleCellChange(dayStr(d), 'ore', val);
                                        }}
                                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-gray-800 bg-gray-50 border-l-2 border-gray-300 text-xs h-10 align-middle">
                              {calculateTotals(rapportino.giorni, daysInMonth).ggIntere} gg
                            </td>
                          </tr>

                          {/* COLLABORATORI RIGA 2: MEZZA GIORNATA */}
                          <tr className="hover:bg-gray-50/50 transition-colors h-10">
                            <td className="px-3 py-2 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 whitespace-nowrap h-10 align-middle">Mezza Giornata</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-0 border-r border-gray-200 h-10 align-middle text-center ${outOfMonth ? 'bg-gray-200/30' : dayStyle.className || ''}`}>
                                  {!outOfMonth && giorno && (
                                    <div className="w-full h-full flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato' || isCellDisabled(d, 'lavoro')}
                                        checked={giorno.ore === 4}
                                        onChange={e => {
                                          const val = e.target.checked ? 4 : 0;
                                          handleCellChange(dayStr(d), 'ore', val);
                                        }}
                                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-gray-800 bg-gray-50 border-l-2 border-gray-300 text-xs h-10 align-middle">
                              {calculateTotals(rapportino.giorni, daysInMonth).ggMezze} gg
                            </td>
                          </tr>

                          {/* COLLABORATORI RIGA 3: TRASFERTA */}
                          <tr className="hover:bg-gray-50/50 transition-colors h-10">
                            <td className="px-3 py-2 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 whitespace-nowrap h-10 align-middle">
                              <div className="flex items-center gap-1.5">
                                <span>Trasferta</span>
                                <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1 py-0.5 rounded font-mono">T</span>
                              </div>
                            </td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-0 border-r border-gray-200 h-10 align-middle text-center ${outOfMonth ? 'bg-gray-200/30' : dayStyle.className || ''}`}>
                                  {!outOfMonth && giorno && (
                                    <div className="w-full h-full flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato' || isCellDisabled(d, 'lavoro')}
                                        checked={giorno.trasferta || false}
                                        onChange={e => handleCellChange(dayStr(d), 'trasferta', e.target.checked)}
                                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-400 cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-blue-600 bg-gray-50 border-l-2 border-gray-300 text-xs h-10 align-middle">
                              {calculateTotals(rapportino.giorni, daysInMonth).ggTrasferta} gg
                            </td>
                          </tr>
                        </>
                      ) : (
                        <>
                          {/* DIPENDENTI STANDARD RIGA 1: ORE ORDINARIE */}
                          <tr className="hover:bg-gray-50/50 transition-colors h-10">
                            <td className="px-3 py-2 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 whitespace-nowrap h-10 align-middle">
                              Ore Ordinarie
                            </td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-0 border-r border-gray-200 h-10 align-middle text-center ${outOfMonth ? 'bg-gray-200/30' : dayStyle.className || (giorno && giorno.ore > 0 ? 'bg-emerald-50/70 font-semibold' : '')}`}>
                                  {!outOfMonth && giorno && (
                                    <div className="w-full h-full flex items-center justify-center font-bold text-gray-900 text-xs">
                                      {giorno.ore > 0 ? formatDec(giorno.ore) : '-'}
                                    </div>
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-gray-800 bg-gray-50 border-l-2 border-gray-300 text-xs h-10 align-middle">
                              {formatDec(calculateTotals(rapportino.giorni, daysInMonth).oreOrd)}
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 2: STRAORDINARI */}
                          <tr className="hover:bg-gray-50/50 transition-colors h-10">
                            <td className="px-3 py-2 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 whitespace-nowrap h-10 align-middle">
                              Straordinari
                            </td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-0 border-r border-gray-200 h-10 align-middle text-center ${outOfMonth ? 'bg-gray-200/30' : dayStyle.className || ''}`}>
                                  {!outOfMonth && giorno && (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <input 
                                        type="number"
                                        min={0}
                                        max={24}
                                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato' || giorno.malattia || isCellDisabled(d, 'lavoro')}
                                        value={giorno.straordinari === 0 ? '' : giorno.straordinari}
                                        onChange={e => handleCellChange(dayStr(d), 'straordinari', e.target.value === '' ? 0 : Number(e.target.value))}
                                        className="w-full h-full text-center border-none p-0 bg-transparent font-extrabold text-amber-600 focus:bg-white text-xs outline-none"
                                      />
                                    </div>
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-amber-600 bg-gray-50 border-l-2 border-gray-300 text-xs h-10 align-middle">
                              {formatDec(calculateTotals(rapportino.giorni, daysInMonth).oreStra)} ore
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 3: PERMESSI */}
                          <tr className="hover:bg-gray-50/50 transition-colors h-10">
                            <td className="px-3 py-2 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 whitespace-nowrap h-10 align-middle">
                              Permessi
                            </td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-0 border-r border-gray-200 h-10 align-middle text-center ${outOfMonth ? 'bg-gray-200/30' : dayStyle.className || (giorno && giorno.permessi > 0 ? 'bg-indigo-100/70' : '')}`}>
                                  {!outOfMonth && giorno && (
                                    <div className="w-full h-full flex items-center justify-center font-bold text-indigo-600 text-xs">
                                      {giorno.permessi > 0 ? formatDec(giorno.permessi) : '-'}
                                    </div>
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-indigo-600 bg-gray-50 border-l-2 border-gray-300 text-xs h-10 align-middle">
                              {formatDec(calculateTotals(rapportino.giorni, daysInMonth).orePerm)} ore
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 4: FERIE */}
                          <tr className="hover:bg-gray-50/50 transition-colors h-10">
                            <td className="px-3 py-2 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 whitespace-nowrap h-10 align-middle">
                              <div className="flex items-center gap-1.5">
                                <span>Ferie</span>
                                <span className="text-[9px] font-bold bg-green-100 text-green-700 px-1 py-0.5 rounded font-mono">F</span>
                              </div>
                            </td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-0 border-r border-gray-200 h-10 align-middle text-center ${outOfMonth ? 'bg-gray-200/30' : dayStyle.className || (giorno && giorno.ferie > 0 ? 'bg-green-100/70' : '')}`}>
                                  {!outOfMonth && giorno && (
                                    <div className="w-full h-full flex items-center justify-center font-bold text-green-700 text-xs">
                                      {giorno.ferie > 0 ? formatDec(giorno.ferie) : '-'}
                                    </div>
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-green-700 bg-gray-50 border-l-2 border-gray-300 text-xs h-10 align-middle">
                              {formatDec(calculateTotals(rapportino.giorni, daysInMonth).oreFerie)} ore
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 5: MALATTIA */}
                          <tr className="hover:bg-gray-50/50 transition-colors h-10">
                            <td className="px-3 py-2 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 whitespace-nowrap h-10 align-middle">
                              <div className="flex items-center gap-1.5">
                                <span>Malattia/Maternità</span>
                                <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1 py-0.5 rounded font-mono">M</span>
                              </div>
                            </td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-0 border-r border-gray-200 h-10 align-middle text-center ${outOfMonth ? 'bg-gray-200/30' : dayStyle.className || (giorno && giorno.malattia ? 'bg-red-100/70' : '')}`}>
                                  {!outOfMonth && giorno && (
                                    <div className="w-full h-full flex items-center justify-center font-bold text-red-600 text-xs">
                                      {giorno.malattia ? 'M' : '-'}
                                    </div>
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-red-600 bg-gray-50 border-l-2 border-gray-300 text-xs h-10 align-middle">
                              {formatDec(calculateTotals(rapportino.giorni, daysInMonth).oreMalattia)} ore
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 5b: PERMESSO STUDIO */}
                          <tr className="hover:bg-gray-50/50 transition-colors h-10">
                            <td className="px-3 py-2 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 whitespace-nowrap h-10 align-middle">
                              <div className="flex items-center gap-1.5">
                                <span>Permesso Studio</span>
                                <span className="text-[9px] font-bold bg-purple-100 text-purple-700 px-1 py-0.5 rounded font-mono">S</span>
                              </div>
                            </td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-0 border-r border-gray-200 h-10 align-middle text-center ${outOfMonth ? 'bg-gray-200/30' : dayStyle.className || (giorno && giorno.permessoStudio ? 'bg-purple-100/70' : '')}`}>
                                  {!outOfMonth && giorno && (
                                    <div className="w-full h-full flex items-center justify-center font-bold text-purple-700 text-xs">
                                      {(giorno.permessoStudio ?? 0) > 0 ? formatDec(giorno.permessoStudio) : '-'}
                                    </div>
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-purple-700 bg-gray-50 border-l-2 border-gray-300 text-xs h-10 align-middle">
                              {formatDec(calculateTotals(rapportino.giorni, daysInMonth).oreStudio)} ore
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 5c: PERMESSO DONAZIONE */}
                          <tr className="hover:bg-gray-50/50 transition-colors h-10">
                            <td className="px-3 py-2 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 whitespace-nowrap h-10 align-middle">
                              <div className="flex items-center gap-1.5">
                                <span>Permesso Donazione</span>
                                <span className="text-[9px] font-bold bg-teal-100 text-teal-700 px-1 py-0.5 rounded font-mono">D</span>
                              </div>
                            </td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-0 border-r border-gray-200 h-10 align-middle text-center ${outOfMonth ? 'bg-gray-200/30' : dayStyle.className || (giorno && giorno.permessoDonazione ? 'bg-teal-100/70' : '')}`}>
                                  {!outOfMonth && giorno && (
                                    <div className="w-full h-full flex items-center justify-center font-bold text-teal-700 text-xs">
                                      {(giorno.permessoDonazione ?? 0) > 0 ? formatDec(giorno.permessoDonazione) : '-'}
                                    </div>
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-teal-700 bg-gray-50 border-l-2 border-gray-300 text-xs h-10 align-middle">
                              {formatDec(calculateTotals(rapportino.giorni, daysInMonth).oreDonazione)} ore
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 5d: PERMESSO ELETTORALE */}
                          <tr className="hover:bg-gray-50/50 transition-colors h-10">
                            <td className="px-3 py-2 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 whitespace-nowrap h-10 align-middle">
                              <div className="flex items-center gap-1.5">
                                <span>Permesso Elettorale</span>
                                <span className="text-[9px] font-bold bg-indigo-100 text-indigo-700 px-1 py-0.5 rounded font-mono">E</span>
                              </div>
                            </td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-0 border-r border-gray-200 h-10 align-middle text-center ${outOfMonth ? 'bg-gray-200/30' : dayStyle.className || (giorno && giorno.permessoElettorale ? 'bg-indigo-100/70' : '')}`}>
                                  {!outOfMonth && giorno && (
                                    <div className="w-full h-full flex items-center justify-center font-bold text-indigo-700 text-xs">
                                      {(giorno.permessoElettorale ?? 0) > 0 ? formatDec(giorno.permessoElettorale) : '-'}
                                    </div>
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-indigo-700 bg-gray-50 border-l-2 border-gray-300 text-xs h-10 align-middle">
                              {formatDec(calculateTotals(rapportino.giorni, daysInMonth).oreElettorale)} ore
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 6: CONTRASSEGNO TRASFERTA */}
                          <tr className="hover:bg-gray-50/50 transition-colors h-10">
                            <td className="px-3 py-2 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 whitespace-nowrap h-10 align-middle">
                              <div className="flex items-center gap-1.5">
                                <span>Trasferta</span>
                                <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1 py-0.5 rounded font-mono">T</span>
                              </div>
                            </td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-0 border-r border-gray-200 h-10 align-middle text-center ${outOfMonth ? 'bg-gray-200/30' : dayStyle.className || ''}`}>
                                  {!outOfMonth && giorno && (
                                    <div className="w-full h-full flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato' || isCellDisabled(d, 'lavoro') || isFullDayAbsence(giorno, giorno.oreContratto)}
                                        checked={giorno.trasferta || false}
                                        onChange={e => handleCellChange(dayStr(d), 'trasferta', e.target.checked)}
                                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-400 cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-blue-600 bg-gray-50 border-l-2 border-gray-300 text-xs h-10 align-middle">
                              {calculateTotals(rapportino.giorni, daysInMonth).ggTrasferta} gg
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 7: CONTRASSEGNO RIMBORSO KM */}
                          <tr className="hover:bg-gray-50/50 transition-colors h-10">
                            <td className="px-3 py-2 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 whitespace-nowrap h-10 align-middle">
                              <div className="flex items-center gap-1.5">
                                <span>Rimborso Km</span>
                                <span className="text-[9px] font-bold bg-amber-100 text-amber-800 px-1 py-0.5 rounded font-mono">K</span>
                              </div>
                            </td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-0 border-r border-gray-200 h-10 align-middle text-center ${outOfMonth ? 'bg-gray-200/30' : dayStyle.className || ''}`}>
                                  {!outOfMonth && giorno && (
                                    <div className="w-full h-full flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato' || isCellDisabled(d, 'lavoro') || isFullDayAbsence(giorno, giorno.oreContratto)}
                                        checked={giorno.rimborsoKm || false}
                                        onChange={e => handleCellChange(dayStr(d), 'rimborsoKm', e.target.checked)}
                                        className="w-4 h-4 rounded text-amber-600 focus:ring-amber-400 cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-amber-700 bg-gray-50 border-l-2 border-gray-300 text-xs h-10 align-middle">
                              {calculateTotals(rapportino.giorni, daysInMonth).ggRimborsoKm} gg
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* DETTAGLIO SPOSTAMENTI, NOTA SPESE E NOTE IN BASSO */}
                <div className="p-6 bg-gray-50/50 border-t space-y-6">
                  
                  {/* 1. SEZIONE Dettaglio Spostamenti, Trasferte e Rimborso Km (A TUTTA LARGHEZZA) */}
                  <div className="space-y-4">
                    <h4 className="font-extrabold text-sm text-gray-800 flex items-center justify-between gap-1.5 border-b pb-2">
                      <span className="flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-amber-600" />
                        <span>Dettaglio Spostamenti, Trasferte e Rimborso Km</span>
                      </span>
                      <span className="text-[10px] font-extrabold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100">
                        Totale Km: {calculateTotals(rapportino.giorni, daysInMonth).totalKm} Km
                      </span>
                    </h4>
                    
                    {getTrasferteList(rapportino.giorni, daysInMonth).length === 0 ? (
                      <p className="text-xs text-gray-400 italic font-medium p-2">Nessun giorno contrassegnato come Trasferta (T) o Rimborso Km (K) nel tabellone presenze.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 max-h-96 overflow-y-auto pr-1">
                        {getTrasferteList(rapportino.giorni, daysInMonth).map(({ giorno, trasferta, rimborsoKm }) => {
                          const gPres = rapportino.giorni[dayStr(giorno)] || {};
                          const isLocked = rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato';
                          const tratte = getTratteForGiorno(gPres);

                          return (
                            <div key={giorno} className="bg-white p-3 rounded-2xl border border-gray-200 shadow-xs space-y-3">
                              <div className="flex items-center justify-between border-b border-gray-100 pb-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-black text-gray-800">Giorno {giorno}</span>
                                  {trasferta && <span className="text-[9px] font-extrabold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Trasferta (T)</span>}
                                  {rimborsoKm && <span className="text-[9px] font-extrabold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">Rimborso Km (K)</span>}
                                </div>
                                <div className="flex items-center gap-1 text-[11px] font-bold text-gray-700">
                                  <span>Km:</span>
                                  <input 
                                    type="number"
                                    min={0}
                                    placeholder="0"
                                    disabled={isLocked}
                                    value={gPres.kmTrasferta === 0 ? '' : gPres.kmTrasferta || ''}
                                    onChange={e => handleCellChange(dayStr(giorno), 'kmTrasferta', e.target.value === '' ? 0 : Number(e.target.value))}
                                    className="w-20 p-1 text-center border border-amber-300 rounded-lg bg-amber-50/50 font-extrabold text-amber-900 outline-none focus:border-amber-500"
                                  />
                                </div>
                              </div>

                              {/* Automezzo */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[9px] font-bold text-gray-400 mb-0.5">Marca Automezzo</label>
                                  <input 
                                    type="text"
                                    placeholder="Es. Fiat"
                                    disabled={isLocked}
                                    value={gPres.marcaAutomezzo || ''}
                                    onChange={e => handleCellChange(dayStr(giorno), 'marcaAutomezzo', e.target.value)}
                                    className="w-full p-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-indigo-400 font-medium"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[9px] font-bold text-gray-400 mb-0.5">Modello Automezzo</label>
                                  <input 
                                    type="text"
                                    placeholder="Es. Panda"
                                    disabled={isLocked}
                                    value={gPres.modelloAutomezzo || ''}
                                    onChange={e => handleCellChange(dayStr(giorno), 'modelloAutomezzo', e.target.value)}
                                    className="w-full p-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-indigo-400 font-medium"
                                  />
                                </div>
                              </div>

                              {/* Lista Tratte Spostamento */}
                              <div className="space-y-2 pt-2 border-t border-gray-100">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-extrabold text-gray-700 uppercase tracking-wider">Tratte Spostamento</span>
                                  {!isLocked && (
                                    <button
                                      type="button"
                                      onClick={() => handleAddTratta(dayStr(giorno))}
                                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-lg transition cursor-pointer"
                                    >
                                      <Plus className="w-3 h-3" />
                                      <span>Aggiungi tratta</span>
                                    </button>
                                  )}
                                </div>

                                {tratte.map((tratta, tIdx) => (
                                  <div key={tIdx} className="bg-gray-50/80 p-2 rounded-xl border border-gray-150 space-y-1">
                                    <div className="flex items-center justify-between text-[9px] font-bold text-gray-500">
                                      <span>Tratta {tIdx + 1}</span>
                                      {!isLocked && tratte.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveTratta(dayStr(giorno), tIdx)}
                                          className="text-red-500 hover:text-red-700 p-0.5 rounded hover:bg-red-50 transition cursor-pointer"
                                          title="Elimina questa tratta"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      <div>
                                        <label className="block text-[9px] font-semibold text-gray-400 mb-0.5">Partenza</label>
                                        <input 
                                          type="text"
                                          placeholder="Es. Sede / Firenze"
                                          disabled={isLocked}
                                          value={tratta.partenza || ''}
                                          onChange={e => handleUpdateTratta(dayStr(giorno), tIdx, 'partenza', e.target.value)}
                                          className="w-full p-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-indigo-400 font-medium bg-white"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[9px] font-semibold text-gray-400 mb-0.5">Arrivo</label>
                                        <input 
                                          type="text"
                                          placeholder="Es. Milano / Cantiere X"
                                          disabled={isLocked}
                                          value={tratta.arrivo || ''}
                                          onChange={e => handleUpdateTratta(dayStr(giorno), tIdx, 'arrivo', e.target.value)}
                                          className="w-full p-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-indigo-400 font-medium bg-white"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 2. SEZIONE NOTA SPESE VARIE SOSTENUTE (€) SOTTO IL DETTAGLIO SPOSTAMENTI */}
                  <div className="pt-4 border-t border-gray-200/80 space-y-3 no-print">
                    <div className="flex justify-between items-center">
                      <h4 className="font-extrabold text-sm text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                        <FileText className="w-4 h-4 text-indigo-600" />
                        <span>Nota Spese Varie Sostenute (€)</span>
                      </h4>
                      <div className="text-xs font-bold text-gray-600">
                        Totale Spese: <span className="font-black text-indigo-700">{formatDec((
                          (rapportino.rimborsoSpeseData?.speseViaggio || 0) +
                          (rapportino.rimborsoSpeseData?.speseTaxiBus || 0) +
                          (rapportino.rimborsoSpeseData?.speseParcheggi || 0) +
                          (rapportino.rimborsoSpeseData?.speseVitto || 0) +
                          (rapportino.rimborsoSpeseData?.speseAlloggio || 0) +
                          (rapportino.rimborsoSpeseData?.spesePedaggi || 0) +
                          (rapportino.rimborsoSpeseData?.speseAltro || 0)
                        ).toFixed(2))} €</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 mb-1">Viaggio (Treno/Aereo)</label>
                        <input 
                          type="number"
                          step="any"
                          min="0"
                          disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                          value={rapportino.rimborsoSpeseData?.speseViaggio === 0 ? '' : rapportino.rimborsoSpeseData?.speseViaggio || ''}
                          onChange={e => handleRimborsoFieldChange('speseViaggio', e.target.value === '' ? 0 : Number(e.target.value))}
                          className="w-full p-2 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 mb-1">Taxi / Autobus</label>
                        <input 
                          type="number"
                          step="any"
                          min="0"
                          disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                          value={rapportino.rimborsoSpeseData?.speseTaxiBus === 0 ? '' : rapportino.rimborsoSpeseData?.speseTaxiBus || ''}
                          onChange={e => handleRimborsoFieldChange('speseTaxiBus', e.target.value === '' ? 0 : Number(e.target.value))}
                          className="w-full p-2 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 mb-1">Parcheggi</label>
                        <input 
                          type="number"
                          step="any"
                          min="0"
                          disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                          value={rapportino.rimborsoSpeseData?.speseParcheggi === 0 ? '' : rapportino.rimborsoSpeseData?.speseParcheggi || ''}
                          onChange={e => handleRimborsoFieldChange('speseParcheggi', e.target.value === '' ? 0 : Number(e.target.value))}
                          className="w-full p-2 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 mb-1">Vitto</label>
                        <input 
                          type="number"
                          step="any"
                          min="0"
                          disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                          value={rapportino.rimborsoSpeseData?.speseVitto === 0 ? '' : rapportino.rimborsoSpeseData?.speseVitto || ''}
                          onChange={e => handleRimborsoFieldChange('speseVitto', e.target.value === '' ? 0 : Number(e.target.value))}
                          className="w-full p-2 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 mb-1">Alloggio</label>
                        <input 
                          type="number"
                          step="any"
                          min="0"
                          disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                          value={rapportino.rimborsoSpeseData?.speseAlloggio === 0 ? '' : rapportino.rimborsoSpeseData?.speseAlloggio || ''}
                          onChange={e => handleRimborsoFieldChange('speseAlloggio', e.target.value === '' ? 0 : Number(e.target.value))}
                          className="w-full p-2 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 mb-1">Pedaggi</label>
                        <input 
                          type="number"
                          step="any"
                          min="0"
                          disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                          value={rapportino.rimborsoSpeseData?.spesePedaggi === 0 ? '' : rapportino.rimborsoSpeseData?.spesePedaggi || ''}
                          onChange={e => handleRimborsoFieldChange('spesePedaggi', e.target.value === '' ? 0 : Number(e.target.value))}
                          className="w-full p-2 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 mb-1">Altro</label>
                        <input 
                          type="number"
                          step="any"
                          min="0"
                          disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                          value={rapportino.rimborsoSpeseData?.speseAltro === 0 ? '' : rapportino.rimborsoSpeseData?.speseAltro || ''}
                          onChange={e => handleRimborsoFieldChange('speseAltro', e.target.value === '' ? 0 : Number(e.target.value))}
                          className="w-full p-2 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400 bg-white"
                        />
                      </div>
                    </div>

                    <div className="pt-1">
                      <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Specificare voce Altro (se valorizzata)</label>
                      <input 
                        type="text"
                        placeholder="Es. Acquisto materiale ufficio urgente"
                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                        value={rapportino.rimborsoSpeseData?.altroSpecificare || ''}
                        onChange={e => handleRimborsoFieldChange('altroSpecificare', e.target.value)}
                        className="w-full p-2.5 border rounded-xl text-xs outline-none focus:border-indigo-400 font-medium text-gray-800 bg-white"
                      />
                    </div>
                  </div>

                  {/* 3. IN FONDO AL MODULO: CERTIFICATI E COMUNICAZIONI PER L'HR */}
                  <div className="pt-4 border-t border-gray-200/80 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Sezione 1: Certificati / Note Presenze (Figurerà nella Stampa PDF) */}
                    <div className="space-y-1.5">
                      <label className="block text-sm font-extrabold text-gray-800 flex items-center justify-between gap-1.5">
                        <span className="flex items-center gap-1.5">
                          <FileText className="w-4 h-4 text-emerald-600" />
                          <span>Certificati</span>
                        </span>
                        <span className="text-[9px] font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">Incluso in Stampa PDF</span>
                      </label>
                      <p className="text-[10px] text-gray-500 leading-relaxed font-bold">
                        * N.B. Inserire qui eventuali numeri di protocollo dei certificati medici (malattia, maternità) o note ufficiali sulle presenze da includere nel foglio ore stampato.
                      </p>
                      <textarea
                        rows={2}
                        placeholder="Es. Certificato di malattia N° PUC 123456789 dal 12 al 15..."
                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                        value={rapportino.noteDipendente || ''}
                        onChange={e => setRapportino({ ...rapportino, noteDipendente: e.target.value })}
                        className="w-full mt-2 p-3 text-xs border border-gray-300 rounded-xl bg-white outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-medium"
                      />
                    </div>

                    {/* Sezione 2: Comunicazioni per l'HR (Uso Interno - ESCLUSA DALLA STAMPA) */}
                    <div className="space-y-1.5 no-print">
                      <label className="block text-sm font-extrabold text-gray-800 flex items-center justify-between gap-1.5">
                        <span className="flex items-center gap-1.5">
                          <MessageSquare className="w-4 h-4 text-indigo-600" />
                          <span>Comunicazioni per l'HR</span>
                        </span>
                        <span className="text-[9px] font-extrabold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Escluso dalla Stampa</span>
                      </label>
                      <p className="text-[10px] text-gray-500 leading-relaxed font-bold">
                        * N.B. Spazio riservato a comunicazioni interne per l'amministrazione (es. "Ho fatto ore in più, per favore scalatele dai permessi presi nel mese"). Non apparirà nel PDF stampato.
                      </p>
                      <textarea
                        rows={2}
                        placeholder="Inserisci qui eventuali comunicazioni o richieste di aggiustamento per l'HR..."
                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                        value={rapportino.comunicazioniHR || ''}
                        onChange={e => setRapportino({ ...rapportino, comunicazioniHR: e.target.value })}
                        className="w-full mt-2 p-3 text-xs border border-indigo-200 rounded-xl bg-indigo-50/30 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-medium"
                      />
                    </div>
                  </div>

                </div>
              </div>

              {/* PULSANTI DI AZIONE PER TAB ORE */}
              {(rapportino.stato === 'Bozza' || rapportino.stato === 'Richiede Modifica') && (
                <div className="flex justify-end gap-3 no-print mt-6">
                  <button 
                    onClick={handleSaveDraft}
                    disabled={saving || submitting}
                    className="flex items-center gap-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 font-extrabold px-6 py-3.5 rounded-xl transition shadow-md active:scale-95 disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? 'Salvataggio...' : 'Salva Bozza'}
                  </button>
                  <button 
                    onClick={handleSubmitToHR}
                    disabled={saving || submitting}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold px-7 py-3.5 rounded-xl transition shadow-lg active:scale-95 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    {submitting ? 'Invio in corso...' : 'Invia a HR'}
                  </button>
                </div>
              )}
            </>
          )}
          </>
        )}
      </div>
    )}
  </div>
)}

      {/* ======================================================== */}
      {/* 3. MODAL DETTAGLIO / APPROVAZIONE RAPPORTINO (PER HR/ADMIN) */}
      {/* ======================================================== */}
      {reviewingRapportino && (() => {
        const reviewProfile = dipendenti.find(d => d.nome.trim().toLowerCase() === reviewingRapportino.dipendenteNome.trim().toLowerCase());
        const reviewContractHours = reviewProfile?.oreContratto ?? 8;
        const isCollab = isCollaboratore(reviewingRapportino.dipendenteNome, dipendenti);
        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 no-print overflow-y-auto">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-6xl xl:max-w-7xl overflow-hidden flex flex-col my-4 max-h-[92vh]">
            
            {/* Header Modal */}
            <div className="bg-gradient-to-r from-indigo-700 to-violet-800 p-5 flex justify-between items-center text-white shrink-0">
              <div>
                <h3 className="font-extrabold text-lg flex items-center gap-2">
                  <FileText className="w-5 h-5" /> 
                  {isCollab ? 'Esamina Bozza Fattura' : 'Esamina Rapportino'}: {reviewingRapportino.dipendenteNome}
                </h3>
                <p className="text-[11px] opacity-80 font-bold mt-0.5">Mese: {MESI[selectedMonth-1]} {selectedYear} | Email: {reviewingRapportino.dipendenteEmail}</p>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  type="button"
                  onClick={() => {
                    setPrintTargetSheet(reviewingRapportino);
                    setTimeout(() => {
                      window.print();
                      setPrintTargetSheet(null);
                    }, 150);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white rounded-xl text-xs font-extrabold transition active:scale-95 cursor-pointer shadow-xs border border-white/30"
                  title={isCollab ? "Stampa unicamente questa bozza di fattura" : "Stampa unicamente questo foglio ore"}
                >
                  <Printer className="w-4 h-4 text-white" />
                  <span>Stampa Singolo Documento</span>
                </button>
                <button 
                  onClick={() => setReviewingRapportino(null)} 
                  className="hover:bg-white/20 p-2 rounded-full transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Corpo Modal */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              
              {/* Stato Attuale e Note/Comunicazioni */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-50 p-4 rounded-xl border flex flex-col justify-between">
                  <div>
                    <div className="text-[10px] text-gray-500 font-bold uppercase">Stato del Foglio Ore</div>
                    <div className="mt-1 flex items-center gap-2">
                      {getStatusBadge(reviewingRapportino.stato)}
                      {reviewingRapportino.stato === 'Inviato' && reviewingRapportino.submittedAt && (
                        <span className="text-[10px] text-gray-400 font-medium">Inviato il: {new Date(reviewingRapportino.submittedAt).toLocaleDateString('it-IT')}</span>
                      )}
                    </div>
                  </div>
                  {reviewingRapportino.hrModified && (
                    <div className="mt-2 text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-100 flex items-center gap-1">
                      <Check className="w-3 h-3 text-indigo-600" />
                      Rettificato manualmente da HR
                    </div>
                  )}
                </div>

                {/* Sezione 1: Certificati (Stampati in PDF) */}
                <div className="bg-emerald-50/40 p-4 rounded-xl border border-emerald-200 flex flex-col justify-between">
                  <div className="flex justify-between items-center mb-1">
                    <div className="text-[10px] text-emerald-900 font-extrabold uppercase flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5 text-emerald-600" />
                      Certificati
                    </div>
                    <span className="text-[9px] font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">Incluso in PDF</span>
                  </div>
                  <textarea
                    rows={2}
                    value={reviewingRapportino.noteDipendente || ''}
                    onChange={e => setReviewingRapportino({ ...reviewingRapportino, noteDipendente: e.target.value })}
                    placeholder="Certificati medici, protocolli o note ufficiali..."
                    className="w-full text-xs font-medium text-gray-800 bg-white p-2 border border-emerald-200 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                {/* Sezione 2: Comunicazioni per l'HR (Uso Interno - Escluso da Stampa) */}
                <div className="bg-indigo-50/40 p-4 rounded-xl border border-indigo-200 no-print flex flex-col justify-between">
                  <div className="flex justify-between items-center mb-1">
                    <div className="text-[10px] text-indigo-950 font-extrabold uppercase flex items-center gap-1">
                      <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
                      Comunicazioni HR
                    </div>
                    <span className="text-[9px] font-bold bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full">Escluso da PDF</span>
                  </div>
                  <textarea
                    rows={2}
                    value={reviewingRapportino.comunicazioniHR || ''}
                    onChange={e => setReviewingRapportino({ ...reviewingRapportino, comunicazioniHR: e.target.value })}
                    placeholder="Messaggi interni dal dipendente all'HR..."
                    className="w-full text-xs font-medium text-gray-800 bg-white p-2 border border-indigo-200 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {isCollaboratore(reviewingRapportino.dipendenteNome, dipendenti) ? (
                // COLLABORATOR REVIEW LAYOUT
                <div className="border rounded-2xl overflow-hidden shadow-sm bg-white p-6 space-y-4 text-left">
                  <div className="flex justify-between items-center border-b pb-3">
                    <div>
                      <h4 className="font-extrabold text-sm text-gray-900 uppercase">Dettaglio Calcolo Fatturazione</h4>
                      <p className="text-[10px] text-gray-500 font-semibold">Valori calcolati per il compenso mensile e le tasse del collaboratore.</p>
                    </div>
                    {reviewingRapportino.collaboratoreData && (
                      <button onClick={() => window.print()} className="flex items-center gap-1.5 text-gray-700 hover:text-gray-900 font-extrabold text-[10px] bg-white border px-2.5 py-1.5 rounded-lg shadow-sm hover:shadow active:scale-95 transition-all no-print">
                        <Printer className="w-3 h-3" /> Stampa Fattura
                      </button>
                    )}
                  </div>

                  {reviewingRapportino.collaboratoreData ? (
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-100 border-b border-gray-200 uppercase font-bold text-gray-655 text-[9px]">
                          <th className="p-2.5 w-1/3">Voce / Descrizione</th>
                          <th className="p-2.5 w-1/3 text-right">Aliquota / Parametro</th>
                          <th className="p-2.5 w-1/3 text-right">Importo (€)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 font-medium text-gray-700">
                        {/* COMPENSO MENSILE */}
                        {reviewingRapportino.collaboratoreData.importoFissoMensile && Number(reviewingRapportino.collaboratoreData.importoFissoMensile) > 0 ? (
                          <>
                            <tr className="bg-blue-50/30">
                              <td className="p-2.5 font-semibold text-blue-900">
                                Compenso Mensile Fisso
                                <span className="ml-1 text-[9px] text-blue-500 font-normal">(accordo a canone fisso · modificabile)</span>
                              </td>
                              <td className="p-2.5 text-right">
                                <input 
                                  type="number"
                                  step="any"
                                  min="0"
                                  disabled={reviewingRapportino.stato === 'Approvato'}
                                  value={reviewingRapportino.collaboratoreData.importoFissoMensile}
                                  onChange={e => handleReviewCollabFieldChange('importoFissoMensile', Number(e.target.value))}
                                  className="w-20 p-1 text-xs text-right border rounded bg-white font-bold outline-none focus:border-blue-400"
                                /> €
                              </td>
                              <td className="p-2.5 text-right font-semibold text-blue-900">
                                {formatDec((Number(reviewingRapportino.collaboratoreData.importoFissoMensile)).toFixed(2))} €
                              </td>
                            </tr>
                          </>
                        ) : (
                          <>
                            <tr>
                              <td className="p-2.5 font-semibold">
                                Giornate Lavorate
                                <span className="ml-1 text-[9px] text-gray-400 font-normal">(calcolate auto · modificabili)</span>
                              </td>
                              <td className="p-2.5 text-right">
                                <input 
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  disabled={reviewingRapportino.stato === 'Approvato'}
                                  value={reviewingRapportino.collaboratoreData.giornateOverride ?? reviewingRapportino.collaboratoreData.giornate}
                                  onChange={e => handleReviewCollabFieldChange('giornateOverride', Number(e.target.value))}
                                  className="w-20 p-1 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                                />
                              </td>
                              <td className="p-2.5 text-right">-</td>
                            </tr>
                            <tr>
                              <td className="p-2.5 font-semibold">Compenso Giornaliero (Contratto)</td>
                              <td className="p-2.5 text-right">
                                <input 
                                  type="number"
                                  step="any"
                                  min="0"
                                  disabled={reviewingRapportino.stato === 'Approvato'}
                                  value={reviewingRapportino.collaboratoreData.dailyRate}
                                  onChange={e => handleReviewCollabFieldChange('dailyRate', Number(e.target.value))}
                                  className="w-20 p-1 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                                /> €/gg
                              </td>
                              <td className="p-2.5 text-right">-</td>
                            </tr>
                            <tr className="bg-amber-50/20 font-bold">
                              <td className="p-2.5">Compenso Mensile (Giornate × Tariffa)</td>
                              <td className="p-2.5 text-right">-</td>
                              <td className="p-2.5 text-right text-gray-900">{formatDec(reviewingRapportino.collaboratoreData.compensoMensile.toFixed(2))} €</td>
                            </tr>
                            
                            {/* HR can input a flat rate here to enable it */}
                            <tr className="bg-gray-50">
                              <td className="p-2.5 font-semibold text-gray-600">
                                Importo Fisso Mensile
                                <span className="ml-1 text-[9px] text-gray-400 font-normal">(0 = disabilitato)</span>
                              </td>
                              <td className="p-2.5 text-right">
                                <input 
                                  type="number"
                                  step="any"
                                  min="0"
                                  disabled={reviewingRapportino.stato === 'Approvato'}
                                  value={reviewingRapportino.collaboratoreData.importoFissoMensile ?? 0}
                                  onChange={e => handleReviewCollabFieldChange('importoFissoMensile', Number(e.target.value))}
                                  className="w-20 p-1 text-xs text-right border rounded bg-white font-bold outline-none focus:border-blue-400"
                                /> €
                              </td>
                              <td className="p-2.5 text-right text-gray-450">-</td>
                            </tr>
                          </>
                        )}

                        {/* SPESE & KM */}
                        <tr>
                          <td className="p-2.5 font-semibold">Spese (Vitto, alloggio, ecc.)</td>
                          <td className="p-2.5 text-right">
                            <input 
                              type="number"
                              step="any"
                              min="0"
                              disabled={reviewingRapportino.stato === 'Approvato'}
                              value={reviewingRapportino.collaboratoreData.spese}
                              onChange={e => handleReviewCollabFieldChange('spese', Number(e.target.value))}
                              className="w-20 p-1 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                            />
                          </td>
                          <td className="p-2.5 text-right text-gray-900">{formatDec(reviewingRapportino.collaboratoreData.spese.toFixed(2))} €</td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-semibold">Chilometri Percorsi</td>
                          <td className="p-2.5 text-right">
                            <input 
                              type="number"
                              step="any"
                              min="0"
                              disabled={reviewingRapportino.stato === 'Approvato'}
                              value={reviewingRapportino.collaboratoreData.km}
                              onChange={e => handleReviewCollabFieldChange('km', Number(e.target.value))}
                              className="w-20 p-1 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                            />
                          </td>
                          <td className="p-2.5 text-right">-</td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-semibold">Tariffa Chilometrica (€/km)</td>
                          <td className="p-2.5 text-right">
                            <input 
                              type="number"
                              step="any"
                              min="0"
                              disabled={reviewingRapportino.stato === 'Approvato'}
                              value={reviewingRapportino.collaboratoreData.kmRate}
                              onChange={e => handleReviewCollabFieldChange('kmRate', Number(e.target.value))}
                              className="w-20 p-1 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                            />
                          </td>
                          <td className="p-2.5 text-right">-</td>
                        </tr>
                        <tr className="bg-amber-50/20 font-bold">
                          <td className="p-2.5">Rimborso Chilometrico (Km × Tariffa)</td>
                          <td className="p-2.5 text-right">-</td>
                          <td className="p-2.5 text-right text-gray-900">{formatDec(reviewingRapportino.collaboratoreData.rimborsoKm.toFixed(2))} €</td>
                        </tr>

                        {/* TOTAL COMPENSO */}
                        <tr className="bg-amber-100/30 text-xs font-extrabold border-y border-amber-200">
                          <td className="p-2.5 uppercase">Totale Compenso (Imponibile)</td>
                          <td className="p-2.5 text-right">-</td>
                          <td className="p-2.5 text-right text-amber-900">{formatDec(reviewingRapportino.collaboratoreData.totaleCompenso.toFixed(2))} €</td>
                        </tr>

                        {/* TAX RATES */}
                        <tr>
                          <td className="p-2.5 font-semibold">
                            <input
                              type="text"
                              placeholder="Contributo cassa previdenziale"
                              disabled={reviewingRapportino.stato === 'Approvato'}
                              value={reviewingRapportino.collaboratoreData.cassaLabel ?? 'Contributo cassa previdenziale'}
                              onChange={e => handleReviewCollabFieldChange('cassaLabel', e.target.value)}
                              className="!px-0 !mx-0 !text-left border-b border-dashed border-gray-300 bg-transparent outline-none font-semibold text-xs text-gray-700 w-full focus:border-amber-400"
                            />
                            <span className="text-[9px] text-gray-400 block mt-0.5">(es. INPS, Inarcassa, Cassa Geometri - clicca per modificare)</span>
                          </td>
                          <td className="p-2.5 text-right">
                            <input 
                              type="number"
                              step="any"
                              min="0"
                              disabled={reviewingRapportino.stato === 'Approvato'}
                              value={reviewingRapportino.collaboratoreData.inpsRate}
                              onChange={e => handleReviewCollabFieldChange('inpsRate', Number(e.target.value))}
                              className="w-20 p-1 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                            /> %
                          </td>
                          <td className="p-2.5 text-right text-gray-900">{formatDec(reviewingRapportino.collaboratoreData.inps.toFixed(2))} €</td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-semibold">IVA</td>
                          <td className="p-2.5 text-right">
                            <input 
                              type="number"
                              step="any"
                              min="0"
                              disabled={reviewingRapportino.stato === 'Approvato'}
                              value={reviewingRapportino.collaboratoreData.ivaRate}
                              onChange={e => handleReviewCollabFieldChange('ivaRate', Number(e.target.value))}
                              className="w-20 p-1 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                            /> %
                          </td>
                          <td className="p-2.5 text-right text-gray-900">{formatDec(reviewingRapportino.collaboratoreData.iva.toFixed(2))} €</td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-semibold">Ritenuta d'Acconto</td>
                          <td className="p-2.5 text-right">
                            <input 
                              type="number"
                              step="any"
                              min="0"
                              disabled={reviewingRapportino.stato === 'Approvato'}
                              value={reviewingRapportino.collaboratoreData.raRate}
                              onChange={e => handleReviewCollabFieldChange('raRate', Number(e.target.value))}
                              className="w-20 p-1 text-xs text-right border rounded bg-white font-bold outline-none focus:border-amber-400"
                            /> %
                          </td>
                          <td className="p-2.5 text-right text-red-655">- {formatDec(reviewingRapportino.collaboratoreData.ra.toFixed(2))} €</td>
                        </tr>

                        {/* TOTAL DUE */}
                        <tr className="bg-amber-600/10 text-xs font-black border-t-2 border-amber-600">
                          <td className="p-3 uppercase text-amber-950">TOTALE DOVUTO (A PAGARE)</td>
                          <td className="p-3 text-right">-</td>
                          <td className="p-3 text-right text-amber-900 text-sm font-black">{formatDec(reviewingRapportino.collaboratoreData.totaleDovuto.toFixed(2))} €</td>
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-gray-500 italic">Nessun dato di calcolo collaboratore presente...</p>
                  )}
                </div>
              ) : (
                // STANDARD EMPLOYEE REVIEW TABLE
                <>
              {/* Tabella 1-31 Modificabile dall'HR se necessario */}
              <div className="border rounded-2xl overflow-hidden shadow-sm bg-white">
                <div className="px-4 py-2.5 bg-gray-50 text-[10px] text-gray-500 font-bold border-b">
                  TABELLONE ORE (PUOI ESEGUIRE CORREZIONI DIRETTAMENTE SE NECESSARIO)
                </div>
                <div className="w-full overflow-x-auto scrollbar-thin">
                  <table className="w-full text-center border-collapse min-w-[980px] xl:min-w-0 text-[11px]">
                    <thead>
                      <tr className="bg-gray-100 border-b border-gray-200 text-[9px] uppercase font-bold text-gray-600">
                        <th className="p-2.5 text-left w-28 font-bold bg-gray-100 sticky left-0 z-10 border-r">Giorno</th>
                        {Array.from({ length: 31 }).map((_, i) => {
                          const d = i + 1;
                          const out = d > daysInMonth;
                          const dayStyle = getCellDayStyle(d);
                          return (
                            <th 
                              key={i} 
                              style={dayStyle.style}
                              className={`p-1.5 border-r w-[2.8%] ${out ? 'bg-gray-300/50 text-gray-400' : dayStyle.className || 'text-gray-700'}`}
                            >
                              {d}
                            </th>
                          );
                        })}
                        <th className="p-2.5 font-bold bg-gray-50 border-l w-12">TOT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y font-medium text-gray-700">
                      {isCollaboratore(reviewingRapportino.dipendenteNome, dipendenti) ? (
                        <>
                          {/* COLLABORATORI RIGA 1: GIORNATA INTERA */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Giornata Intera</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-1 border-r ${out ? 'bg-gray-100/30' : dayStyle.className || ''} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={isCellDisabled(d, 'lavoro')}
                                        checked={g.ore === 8}
                                        onChange={e => {
                                          const val = e.target.checked ? 8 : 0;
                                          handleReviewCellChange(dayStr(d), 'ore', val);
                                        }}
                                        className="w-3.5 h-3.5 rounded text-indigo-600 cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold bg-gray-50 border-l">
                              {calculateTotals(reviewingRapportino.giorni, daysInMonth).ggIntere} gg
                            </td>
                          </tr>

                          {/* COLLABORATORI RIGA 2: MEZZA GIORNATA */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Mezza Giornata</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-1 border-r ${out ? 'bg-gray-100/30' : dayStyle.className || ''} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={isCellDisabled(d, 'lavoro')}
                                        checked={g.ore === 4}
                                        onChange={e => {
                                          const val = e.target.checked ? 4 : 0;
                                          handleReviewCellChange(dayStr(d), 'ore', val);
                                        }}
                                        className="w-3.5 h-3.5 rounded text-indigo-600 cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold bg-gray-50 border-l">
                              {calculateTotals(reviewingRapportino.giorni, daysInMonth).ggMezze} gg
                            </td>
                          </tr>

                          {/* COLLABORATORI RIGA 3: TRASFERTA */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Trasferta</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-1 border-r ${out ? 'bg-gray-100/30' : dayStyle.className || ''} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={isCellDisabled(d, 'lavoro')}
                                        checked={g.trasferta || false}
                                        onChange={e => handleReviewCellChange(dayStr(d), 'trasferta', e.target.checked)}
                                        className="w-3.5 h-3.5 rounded text-blue-500 cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-blue-600 bg-gray-50 border-l">
                              {calculateTotals(reviewingRapportino.giorni, daysInMonth).ggTrasferta} gg
                            </td>
                          </tr>
                        </>
                      ) : (
                        <>
                          {/* DIPENDENTI STANDARD RIGA 1: ORE ORDINARIE */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Ore Ord.</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-1 border-r ${out ? 'bg-gray-100/30' : dayStyle.className || (g && g.ore > 0 ? 'bg-emerald-50/70' : '')}`}>
                                  {!out && g && (
                                    <input 
                                      type="number"
                                      disabled={g.malattia || isCellDisabled(d, 'lavoro')}
                                      value={g.ore === 0 ? '' : g.ore}
                                      onChange={e => handleReviewCellChange(dayStr(d), 'ore', e.target.value === '' ? 0 : Number(e.target.value))}
                                      className="w-full text-center bg-transparent border-none p-0.5 rounded font-bold outline-none focus:bg-gray-50 text-gray-900"
                                    />
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold bg-gray-50 border-l">
                              {formatDec(calculateTotals(reviewingRapportino.giorni, daysInMonth).oreOrd)}
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 2: STRAORDINARI */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Straord.</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-1 border-r ${out ? 'bg-gray-100/30' : dayStyle.className || ''}`}>
                                  {!out && g && (
                                    <input 
                                      type="number"
                                      disabled={g.malattia || isCellDisabled(d, 'lavoro')}
                                      value={g.straordinari === 0 ? '' : g.straordinari}
                                      onChange={e => handleReviewCellChange(dayStr(d), 'straordinari', e.target.value === '' ? 0 : Number(e.target.value))}
                                      className="w-full text-center bg-transparent border-none p-0.5 rounded font-bold outline-none text-amber-600 focus:bg-gray-50 font-extrabold"
                                    />
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-amber-600 bg-gray-50 border-l">
                              {formatDec(calculateTotals(reviewingRapportino.giorni, daysInMonth).oreStra)}
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 3: PERMESSI */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Permessi</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-1 border-r ${out ? 'bg-gray-100/30' : dayStyle.className || (g && g.permessi > 0 ? 'bg-indigo-100' : '')}`}>
                                  {!out && g && (
                                    <input 
                                      type="number"
                                      disabled={g.malattia || g.ferie === (g.oreContratto ?? reviewContractHours) || isCellDisabled(d, 'assenza')}
                                      value={g.permessi === 0 ? '' : g.permessi}
                                      onChange={e => handleReviewCellChange(dayStr(d), 'permessi', e.target.value === '' ? 0 : Number(e.target.value))}
                                      className="w-full text-center bg-transparent border-none p-0.5 rounded font-bold text-indigo-600 outline-none focus:bg-gray-50"
                                    />
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-indigo-600 bg-gray-50 border-l">
                              {formatDec(calculateTotals(reviewingRapportino.giorni, daysInMonth).orePerm)}
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 4: FERIE */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Ferie</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-1 border-r ${out ? 'bg-gray-100/30' : dayStyle.className || (g && g.ferie ? 'bg-amber-100' : '')} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={g.malattia || isCellDisabled(d, 'assenza')}
                                        checked={!!g.ferie}
                                        onChange={e => handleReviewCellChange(dayStr(d), 'ferie', e.target.checked)}
                                        className="w-3.5 h-3.5 rounded text-green-500 cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-green-700 bg-gray-50 border-l">
                              {formatDec(calculateTotals(reviewingRapportino.giorni, daysInMonth).oreFerie)} ore
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 5: CONTRASSEGNO MALATTIA */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Malattia/Maternità</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-1 border-r ${out ? 'bg-gray-100/30' : dayStyle.className || (g && g.malattia ? 'bg-red-100' : '')} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={isCellDisabled(d, 'assenza')}
                                        checked={g.malattia || false}
                                        onChange={e => handleReviewCellChange(dayStr(d), 'malattia', e.target.checked)}
                                        className="w-3.5 h-3.5 text-red-500 rounded cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-red-600 bg-gray-50 border-l">
                              {formatDec(calculateTotals(reviewingRapportino.giorni, daysInMonth).oreMalattia)} ore
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 5b: PERMESSO STUDIO */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Permesso Studio</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-1 border-r ${out ? 'bg-gray-100/30' : dayStyle.className || (g && g.permessoStudio ? 'bg-purple-100' : '')} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={g.malattia || isCellDisabled(d, 'assenza')}
                                        checked={!!g.permessoStudio}
                                        onChange={e => handleReviewCellChange(dayStr(d), 'permessoStudio', e.target.checked)}
                                        className="w-3.5 h-3.5 rounded text-purple-600 cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-purple-700 bg-gray-50 border-l">
                              {formatDec(calculateTotals(reviewingRapportino.giorni, daysInMonth).oreStudio)} ore
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 5c: PERMESSO DONAZIONE */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Permesso Donazione</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-1 border-r ${out ? 'bg-gray-100/30' : dayStyle.className || (g && g.permessoDonazione ? 'bg-teal-100' : '')} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={g.malattia || isCellDisabled(d, 'assenza')}
                                        checked={!!g.permessoDonazione}
                                        onChange={e => handleReviewCellChange(dayStr(d), 'permessoDonazione', e.target.checked)}
                                        className="w-3.5 h-3.5 rounded text-teal-600 cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-teal-700 bg-gray-50 border-l">
                              {formatDec(calculateTotals(reviewingRapportino.giorni, daysInMonth).oreDonazione)} ore
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 5d: PERMESSO ELETTORALE */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Permesso Elettorale</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-1 border-r ${out ? 'bg-gray-100/30' : dayStyle.className || (g && g.permessoElettorale ? 'bg-indigo-100' : '')} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={g.malattia || isCellDisabled(d, 'assenza')}
                                        checked={!!g.permessoElettorale}
                                        onChange={e => handleReviewCellChange(dayStr(d), 'permessoElettorale', e.target.checked)}
                                        className="w-3.5 h-3.5 rounded text-indigo-600 cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-indigo-700 bg-gray-50 border-l">
                              {formatDec(calculateTotals(reviewingRapportino.giorni, daysInMonth).oreElettorale)} ore
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 6: CONTRASSEGNO TRASFERTA */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Trasferta</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-1 border-r ${out ? 'bg-gray-100/30' : dayStyle.className || ''} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={isCellDisabled(d, 'lavoro') || isFullDayAbsence(g, g.oreContratto)}
                                        checked={g.trasferta || false}
                                        onChange={e => handleReviewCellChange(dayStr(d), 'trasferta', e.target.checked)}
                                        className="w-3.5 h-3.5 text-blue-500 rounded cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-blue-600 bg-gray-50 border-l">
                              {calculateTotals(reviewingRapportino.giorni, daysInMonth).ggTrasferta} gg
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 7: CONTRASSEGNO RIMBORSO KM */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Rimborso Km</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];
                              const dayStyle = getCellDayStyle(d);

                              return (
                                <td key={i} style={dayStyle.style} className={`p-1 border-r ${out ? 'bg-gray-100/30' : dayStyle.className || ''} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={isCellDisabled(d, 'lavoro') || isFullDayAbsence(g, g.oreContratto)}
                                        checked={g.rimborsoKm || false}
                                        onChange={e => handleReviewCellChange(dayStr(d), 'rimborsoKm', e.target.checked)}
                                        className="w-3.5 h-3.5 text-amber-600 rounded cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-amber-700 bg-gray-50 border-l">
                              {calculateTotals(reviewingRapportino.giorni, daysInMonth).ggRimborsoKm} gg
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* NOTA SPESE E TRASFERTE DIPENDENTI - VISTA HR */}
              <div className="bg-white rounded-xl border p-5 space-y-6">
                <div className="border-b pb-3">
                  <h4 className="font-extrabold text-sm text-gray-900 uppercase">Nota Spese e Rimborso Trasferte</h4>
                  <p className="text-[10px] text-gray-500 font-semibold">Verifica e modifica i dati dell'automezzo, le spese trasferta e i chilometri percorsi.</p>
                </div>

                {/* Dati Veicolo */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1">Marca Automezzo</label>
                    <input 
                      type="text"
                      placeholder="Es. Fiat"
                      value={reviewingRapportino.rimborsoSpeseData?.marcaAutomezzo || ''}
                      onChange={e => handleReviewRimborsoFieldChange('marcaAutomezzo', e.target.value)}
                      className="w-full p-2 border rounded-xl text-xs font-bold text-gray-800 outline-none focus:border-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1">Modello Automezzo</label>
                    <input 
                      type="text"
                      placeholder="Es. Panda"
                      value={reviewingRapportino.rimborsoSpeseData?.modelloAutomezzo || ''}
                      onChange={e => handleReviewRimborsoFieldChange('modelloAutomezzo', e.target.value)}
                      className="w-full p-2 border rounded-xl text-xs font-bold text-gray-800 outline-none focus:border-indigo-400"
                    />
                  </div>
                </div>

                {/* Spese Varie */}
                <div className="space-y-3">
                  <h5 className="text-[10px] font-extrabold text-gray-700 uppercase tracking-wider">Spese Varie Sostenute (€)</h5>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                    {[
                      { label: 'Viaggio (Treno/Aereo)', field: 'speseViaggio' },
                      { label: 'Taxi / Autobus', field: 'speseTaxiBus' },
                      { label: 'Parcheggi', field: 'speseParcheggi' },
                      { label: 'Vitto', field: 'speseVitto' },
                      { label: 'Alloggio', field: 'speseAlloggio' },
                      { label: 'Pedaggi', field: 'spesePedaggi' },
                      { label: 'Altro', field: 'speseAltro' }
                    ].map(({ label, field }) => (
                      <div key={field}>
                        <label className="block text-[9px] font-bold text-gray-400 mb-1">{label}</label>
                        <input 
                          type="number"
                          step="any"
                          min="0"
                          value={reviewingRapportino.rimborsoSpeseData?.[field as keyof typeof reviewingRapportino.rimborsoSpeseData] === 0 ? '' : reviewingRapportino.rimborsoSpeseData?.[field as keyof typeof reviewingRapportino.rimborsoSpeseData] || ''}
                          onChange={e => handleReviewRimborsoFieldChange(field, e.target.value === '' ? 0 : Number(e.target.value))}
                          className="w-full p-1.5 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400"
                        />
                      </div>
                    ))}
                  </div>
                  {/* Altro Specificare */}
                  <div className="pt-1">
                    <label className="block text-[10px] font-bold text-gray-500 mb-1">Specificare voce Altro (se valorizzata)</label>
                    <input 
                      type="text"
                      placeholder="Es. Acquisto materiale ufficio"
                      value={reviewingRapportino.rimborsoSpeseData?.altroSpecificare || ''}
                      onChange={e => handleReviewRimborsoFieldChange('altroSpecificare', e.target.value)}
                      className="w-full p-2 border rounded-xl text-xs outline-none focus:border-indigo-400 font-medium text-gray-800"
                    />
                  </div>
                </div>

                {/* Dettaglio Spostamenti, Trasferte e Rimborso Km */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h5 className="text-[10px] font-extrabold text-gray-700 uppercase tracking-wider">Itinerari, Veicoli e Chilometri per Trasferta e Rimborso Km</h5>
                    <span className="text-[10px] font-extrabold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
                      Totale Km: {calculateTotals(reviewingRapportino.giorni, daysInMonth).totalKm} Km
                    </span>
                  </div>

                  {getTrasferteList(reviewingRapportino.giorni, daysInMonth).length === 0 ? (
                    <p className="text-xs text-gray-400 italic">Nessun giorno segnato in Trasferta (T) o Rimborso Km (K) nel tabellone presenze.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[350px] overflow-y-auto pr-1">
                      {getTrasferteList(reviewingRapportino.giorni, daysInMonth).map(({ giorno, trasferta, rimborsoKm }) => {
                        const gPresenza = reviewingRapportino.giorni[dayStr(giorno)] || {};
                        const tratte = getTratteForGiorno(gPresenza);

                        return (
                          <div key={giorno} className="bg-white p-3 rounded-2xl border border-gray-200 shadow-xs space-y-3 text-xs">
                            <div className="flex items-center justify-between border-b border-gray-100 pb-1.5">
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-gray-800">Giorno {giorno}</span>
                                {trasferta && <span className="text-[9px] font-extrabold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">T</span>}
                                {rimborsoKm && <span className="text-[9px] font-extrabold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">K</span>}
                              </div>
                              <div className="flex items-center gap-1 text-xs font-bold text-gray-700">
                                <span>Km:</span>
                                <input 
                                  type="number"
                                  min={0}
                                  value={gPresenza.kmTrasferta === 0 ? '' : gPresenza.kmTrasferta || ''}
                                  onChange={e => handleReviewCellChange(dayStr(giorno), 'kmTrasferta', e.target.value === '' ? 0 : Number(e.target.value))}
                                  className="w-20 p-1 text-center border border-amber-300 rounded-lg bg-amber-50/50 font-extrabold text-amber-900 outline-none focus:border-amber-500 text-xs"
                                />
                              </div>
                            </div>

                            {/* Automezzo */}
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[9px] font-bold text-gray-400 mb-0.5">Marca Auto</label>
                                <input 
                                  type="text"
                                  placeholder="Fiat"
                                  value={gPresenza.marcaAutomezzo || ''}
                                  onChange={e => handleReviewCellChange(dayStr(giorno), 'marcaAutomezzo', e.target.value)}
                                  className="w-full p-1.5 border rounded bg-white text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-[9px] font-bold text-gray-400 mb-0.5">Modello Auto</label>
                                <input 
                                  type="text"
                                  placeholder="Panda"
                                  value={gPresenza.modelloAutomezzo || ''}
                                  onChange={e => handleReviewCellChange(dayStr(giorno), 'modelloAutomezzo', e.target.value)}
                                  className="w-full p-1.5 border rounded bg-white text-xs"
                                />
                              </div>
                            </div>

                            {/* Tratte */}
                            <div className="space-y-2 pt-1 border-t border-gray-100">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-extrabold text-gray-700 uppercase tracking-wider">Tratte Spostamento</span>
                                <button
                                  type="button"
                                  onClick={() => handleAddTratta(dayStr(giorno), true)}
                                  className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-lg transition cursor-pointer"
                                >
                                  <Plus className="w-3 h-3" />
                                  <span>Aggiungi tratta</span>
                                </button>
                              </div>

                              {tratte.map((tratta, tIdx) => (
                                <div key={tIdx} className="bg-gray-50/80 p-2 rounded-xl border border-gray-150 space-y-1">
                                  <div className="flex items-center justify-between text-[9px] font-bold text-gray-500">
                                    <span>Tratta {tIdx + 1}</span>
                                    {tratte.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveTratta(dayStr(giorno), tIdx, true)}
                                        className="text-red-500 hover:text-red-700 p-0.5 rounded hover:bg-red-50 transition cursor-pointer"
                                        title="Elimina questa tratta"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[9px] font-semibold text-gray-400 mb-0.5">Partenza</label>
                                      <input 
                                        type="text"
                                        placeholder="Sede"
                                        value={tratta.partenza || ''}
                                        onChange={e => handleUpdateTratta(dayStr(giorno), tIdx, 'partenza', e.target.value, true)}
                                        className="w-full p-1.5 border rounded bg-white text-xs"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[9px] font-semibold text-gray-400 mb-0.5">Arrivo</label>
                                      <input 
                                        type="text"
                                        placeholder="Milano"
                                        value={tratta.arrivo || ''}
                                        onChange={e => handleUpdateTratta(dayStr(giorno), tIdx, 'arrivo', e.target.value, true)}
                                        className="w-full p-1.5 border rounded bg-white text-xs"
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Riepilogo Totali */}
                {(() => {
                  const rim = reviewingRapportino.rimborsoSpeseData;
                  const totalKm = Object.values(reviewingRapportino.giorni).reduce((sum, g) => sum + (g.kmTrasferta || 0), 0);
                  const totalAltreSpese = (rim?.speseViaggio || 0) + (rim?.speseTaxiBus || 0) + (rim?.speseParcheggi || 0) + (rim?.speseVitto || 0) + (rim?.speseAlloggio || 0) + (rim?.spesePedaggi || 0) + (rim?.speseAltro || 0);
                  return (
                    <div className="bg-indigo-50/40 p-4 rounded-xl border border-indigo-100 flex flex-col sm:flex-row justify-between gap-4 font-bold text-gray-800 text-xs">
                      <div>
                        <div className="text-[9px] text-gray-500 font-extrabold uppercase">Distanza Totale</div>
                        <div className="text-base font-black text-indigo-900 mt-0.5">{totalKm} Km</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-gray-500 font-extrabold uppercase">Altre Spese Totali</div>
                        <div className="text-base font-black text-indigo-900 mt-0.5">{formatDec(totalAltreSpese.toFixed(2))} €</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] text-indigo-600 font-extrabold uppercase font-mono">Contabilizzazione Rimborsi</div>
                        <div className="text-[10px] text-gray-600 mt-0.5 leading-normal font-medium">
                          I rimborsi verranno conteggiati dal consulente del lavoro.
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </div>

            {/* Footer Modal con Azioni */}
            <div className="p-5 border-t bg-gray-50 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleHRSaveModifications}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-xs transition shadow active:scale-95 cursor-pointer"
                >
                  Salva Modifiche
                </button>

                <button 
                  type="button"
                  onClick={() => {
                    setPrintTargetSheet(reviewingRapportino);
                    setTimeout(() => {
                      window.print();
                      setPrintTargetSheet(null);
                    }, 150);
                  }}
                  className="px-3.5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-extrabold rounded-xl text-xs border border-gray-300 transition active:scale-95 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title={isCollab ? "Stampa unicamente questa bozza di fattura" : "Stampa unicamente questo foglio ore"}
                >
                  <Printer className="w-4 h-4 text-gray-600" />
                  <span>Stampa Singolo Documento</span>
                </button>
              </div>

              <div className="flex items-center gap-3">
                {/* Mostra "Richiedi Modifica" ed "Approva" solo se lo stato non è già Approvato */}
                {reviewingRapportino.stato !== 'Approvato' && (
                  <>
                    <button 
                      onClick={() => {
                        setHrFeedbackNote(reviewingRapportino.noteHR || '');
                        setIsFeedbackModalOpen(true);
                      }}
                      className="px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl text-xs transition shadow active:scale-95 cursor-pointer"
                    >
                      Richiedi Modifica
                    </button>
                    <button 
                      onClick={handleHRApprove}
                      disabled={reviewingRapportino.stato === 'Bozza'}
                      className={`px-5 py-2.5 font-bold rounded-xl text-xs transition active:scale-95 ${
                        reviewingRapportino.stato === 'Bozza'
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
                          : 'bg-green-600 hover:bg-green-700 text-white shadow-md cursor-pointer'
                      }`}
                      title={reviewingRapportino.stato === 'Bozza' ? (isCollab ? "Non è possibile approvare una bozza fattura in stato Bozza" : "Non è possibile approvare un rapportino in stato Bozza") : undefined}
                    >
                      {isCollab ? "Approva Bozza Fattura" : "Approva Rapportino"}
                    </button>
                  </>
                )}
                {reviewingRapportino.stato === 'Approvato' && (
                  <div className="flex items-center gap-2">
                    <div className="text-xs font-bold text-green-700 flex items-center gap-1.5 px-3 py-2 bg-green-50 rounded-xl border border-green-200">
                      <Check className="w-4 h-4"/> Approvato
                    </div>
                    <button
                      type="button"
                      onClick={handleHRRevokeApproval}
                      className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-extrabold rounded-xl text-xs transition shadow-md active:scale-95 flex items-center gap-1.5 cursor-pointer"
                      title="Revoca l'approvazione per apportare modifiche o richiedere correzioni"
                    >
                      <span>🔓 Revoca Approvazione / Sblocca Modifica</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
        );
      })()}

      {/* ======================================================== */}
      {/* 4. MODAL DI RICHIESTA CORREZIONE/FEEDBACK (DA HR A UTENTE)  */}
      {/* ======================================================== */}
      {isFeedbackModalOpen && reviewingRapportino && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 no-print">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform scale-100 transition-all">
            <div className="bg-orange-600 p-4 text-white font-extrabold flex justify-between items-center">
              <span>{isCollaboratore(reviewingRapportino.dipendenteNome, dipendenti) ? 'Richiesta Modifica Bozza Fattura' : 'Nota di correzione presenze'}</span>
              <button onClick={() => setIsFeedbackModalOpen(false)} className="hover:bg-white/20 p-1 rounded-full"><X className="w-5 h-5"/></button>
            </div>
            <form onSubmit={handleHRRequestChanges} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-2">
                  {isCollaboratore(reviewingRapportino.dipendenteNome, dipendenti) ? 'Specifica quali correzioni o dati mancano (sarà visibile al collaboratore):' : 'Specifica quali correzioni o documenti mancano (sarà visibile al dipendente):'}
                </label>
                <textarea
                  required
                  rows={4}
                  value={hrFeedbackNote}
                  onChange={e => setHrFeedbackNote(e.target.value)}
                  placeholder="Es. Mancano i giustificativi del giorno 12. Inserisci anche il numero di protocollo della malattia per i giorni 18-20 nelle note."
                  className="w-full p-3 text-xs border border-gray-200 rounded-xl outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                />
              </div>
              <div className="flex justify-end gap-2 text-xs font-bold">
                <button 
                  type="button" 
                  onClick={() => setIsFeedbackModalOpen(false)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
                >
                  Annulla
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg shadow"
                >
                  Invia Nota
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        type={confirmConfig.type}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />

      </div> {/* fine no-print wrapper */}

      <div className="hidden print:block print-container w-full h-full text-[8px] font-sans p-2">
        {(() => {
          const sheets = getSheetsToPrint();
          if (sheets.length === 0) {
            return <div className="text-center p-8 text-gray-400">Nessun documento da stampare per questo mese.</div>;
          }

          return sheets.map((sheetToPrint) => {
            const totals = calculateTotals(sheetToPrint.giorni, daysInMonth);
            const trasferte = getTrasferteList(sheetToPrint.giorni, daysInMonth);
            const isCollab = isCollaboratore(sheetToPrint.dipendenteNome, dipendenti);
            const dailyNotes = getDailyNotes(sheetToPrint.giorni, daysInMonth);

            return (
              <div key={sheetToPrint.id} className={`sheet-break ${isCollab ? 'print-portrait-page max-w-[21cm] mx-auto p-4' : 'space-y-3'}`}>
                {!isCollab ? (
                  <>
                    {/* Intestazione Documento */}
                    <div className="flex justify-between items-end border-b border-gray-900 pb-1">
                      <div className="flex items-center gap-2 pb-0.5">
                        <img src="/Logo.png" alt="Logo Ingegno" className="h-6 w-auto object-contain" />
                        <div className="border-l border-gray-300 pl-2 py-0.5">
                          <div className="text-[7.5px] text-gray-500 font-bold leading-none">Presenze ed Ore Lavorate</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-extrabold text-gray-900">SCHEMA PRESENZE</div>
                        <div className="text-[8.5px] font-bold text-gray-800">
                          Mese: {MESI[selectedMonth - 1].toUpperCase()} {selectedYear}
                        </div>
                      </div>
                    </div>

                    {/* Dettagli Anagrafici */}
                    <div className="grid grid-cols-2 gap-2 border border-gray-300 p-2 bg-gray-50 rounded text-[8px]">
                      <div>
                        <span className="font-extrabold text-gray-600">DIPENDENTE:</span>{' '}
                        <span className="font-extrabold text-gray-900 uppercase">{sheetToPrint.dipendenteNome}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-extrabold text-gray-600">EMAIL:</span>{' '}
                        <span className="font-semibold text-gray-900">{sheetToPrint.dipendenteEmail}</span>
                      </div>
                    </div>

                    <table className="w-full text-center border border-gray-955 table-fixed text-[7px]">
                      <thead>
                        <tr className="bg-gray-150 border-b border-gray-955 font-bold text-gray-900 text-[7px]">
                          <th className="p-1 border-r border-gray-905 text-left w-[12%] font-extrabold">RIGA/GIORNO</th>
                          {Array.from({ length: 31 }).map((_, i) => (
                            <th key={i} className="p-0.5 border-r border-gray-905 w-[2.6%] font-extrabold">{i + 1}</th>
                          ))}
                          <th className="p-1 border-l border-gray-905 w-[6%] font-extrabold">TOT</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-955 font-semibold text-gray-900">
                        <tr>
                          <td className="p-1 text-left bg-gray-50 border-r border-gray-955 font-extrabold">ORE</td>
                          {Array.from({ length: 31 }).map((_, i) => {
                            const d = i + 1;
                            const val = sheetToPrint.giorni[dayStr(d)]?.ore;
                            const out = d > daysInMonth;
                            const hasVal = !out && val && val > 0;
                            return (
                              <td 
                                key={i} 
                                className={`p-0.5 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}
                                style={hasVal ? { backgroundColor: '#bbf7d0' } : undefined}
                              >
                                {!out ? formatDec(val || 0) : ''}
                              </td>
                            );
                          })}
                          <td className="p-1 font-extrabold bg-gray-100">{formatDec(totals.oreOrd)}</td>
                        </tr>
                        <tr>
                          <td className="p-1 text-left bg-gray-50 border-r border-gray-955 font-extrabold">STRAORDINARI</td>
                          {Array.from({ length: 31 }).map((_, i) => {
                            const d = i + 1;
                            const val = sheetToPrint.giorni[dayStr(d)]?.straordinari;
                            const out = d > daysInMonth;
                            return (
                              <td key={i} className={`p-0.5 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}>
                                {!out ? formatDec(val || 0) : ''}
                              </td>
                            );
                          })}
                          <td className="p-1 font-extrabold bg-gray-100">{formatDec(totals.oreStra)}</td>
                        </tr>
                        <tr>
                          <td className="p-1 text-left bg-gray-50 border-r border-gray-955 font-extrabold">PERMESSI</td>
                          {Array.from({ length: 31 }).map((_, i) => {
                            const d = i + 1;
                            const val = sheetToPrint.giorni[dayStr(d)]?.permessi;
                            const out = d > daysInMonth;
                            const hasVal = !out && val && val > 0;
                            return (
                              <td 
                                key={i} 
                                className={`p-0.5 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}
                                style={hasVal ? { backgroundColor: '#c7d2fe' } : undefined}
                              >
                                {!out ? formatDec(val || 0) : ''}
                              </td>
                            );
                          })}
                          <td className="p-1 font-extrabold bg-gray-100">{formatDec(totals.orePerm)}</td>
                        </tr>
                        <tr>
                          <td className="p-1 text-left bg-gray-50 border-r border-gray-955 font-extrabold">FERIE (F)</td>
                          {Array.from({ length: 31 }).map((_, i) => {
                            const d = i + 1;
                            const val = sheetToPrint.giorni[dayStr(d)]?.ferie;
                            const out = d > daysInMonth;
                            const hasVal = !out && val && val > 0;
                            return (
                              <td 
                                key={i} 
                                className={`p-0.5 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}
                                style={hasVal ? { backgroundColor: '#fef08a' } : undefined}
                              >
                                {!out && val && val > 0 ? formatDec(val) : ''}
                              </td>
                            );
                          })}
                          <td className="p-1 font-extrabold bg-gray-100">{formatDec(totals.oreFerie)} ore</td>
                        </tr>
                        <tr>
                          <td className="p-1 text-left bg-gray-50 border-r border-gray-955 font-extrabold">MALATTIA (M)</td>
                          {Array.from({ length: 31 }).map((_, i) => {
                            const d = i + 1;
                            const g = sheetToPrint.giorni[dayStr(d)];
                            const val = g?.malattia;
                            const out = d > daysInMonth;
                            const hasVal = !out && val;
                            const hCount = g?.oreContratto || contractHours || 8;
                            return (
                              <td 
                                key={i} 
                                className={`p-0.5 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}
                                style={hasVal ? { backgroundColor: '#fca5a5' } : undefined}
                              >
                                {!out && val ? formatDec(hCount) : ''}
                              </td>
                            );
                          })}
                          <td className="p-1 font-extrabold bg-gray-100">{formatDec(totals.oreMalattia)} ore</td>
                        </tr>
                        <tr>
                          <td className="p-1 text-left bg-gray-50 border-r border-gray-955 font-extrabold">STUDIO (S)</td>
                          {Array.from({ length: 31 }).map((_, i) => {
                            const d = i + 1;
                            const val = sheetToPrint.giorni[dayStr(d)]?.permessoStudio;
                            const out = d > daysInMonth;
                            const hasVal = !out && val && val > 0;
                            return (
                              <td 
                                key={i} 
                                className={`p-0.5 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}
                                style={hasVal ? { backgroundColor: '#e9d5ff' } : undefined}
                              >
                                {!out && val && val > 0 ? formatDec(val) : ''}
                              </td>
                            );
                          })}
                          <td className="p-1 font-extrabold bg-gray-100">{formatDec(totals.oreStudio)} ore</td>
                        </tr>
                        <tr>
                          <td className="p-1 text-left bg-gray-50 border-r border-gray-955 font-extrabold">DONAZIONE (D)</td>
                          {Array.from({ length: 31 }).map((_, i) => {
                            const d = i + 1;
                            const val = sheetToPrint.giorni[dayStr(d)]?.permessoDonazione;
                            const out = d > daysInMonth;
                            const hasVal = !out && val && val > 0;
                            return (
                              <td 
                                key={i} 
                                className={`p-0.5 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}
                                style={hasVal ? { backgroundColor: '#99f6e4' } : undefined}
                              >
                                {!out && val && val > 0 ? formatDec(val) : ''}
                              </td>
                            );
                          })}
                          <td className="p-1 font-extrabold bg-gray-100">{formatDec(totals.oreDonazione)} ore</td>
                        </tr>
                        <tr>
                          <td className="p-1 text-left bg-gray-50 border-r border-gray-955 font-extrabold">ELETTORALE (E)</td>
                          {Array.from({ length: 31 }).map((_, i) => {
                            const d = i + 1;
                            const val = sheetToPrint.giorni[dayStr(d)]?.permessoElettorale;
                            const out = d > daysInMonth;
                            const hasVal = !out && val && val > 0;
                            return (
                              <td 
                                key={i} 
                                className={`p-0.5 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}
                                style={hasVal ? { backgroundColor: '#c7d2fe' } : undefined}
                              >
                                {!out && val && val > 0 ? formatDec(val) : ''}
                              </td>
                            );
                          })}
                          <td className="p-1 font-extrabold bg-gray-100">{formatDec(totals.oreElettorale)} ore</td>
                        </tr>
                        <tr>
                          <td className="p-1 text-left bg-gray-50 border-r border-gray-955 font-extrabold">TRASFERTA (T)</td>
                          {Array.from({ length: 31 }).map((_, i) => {
                            const d = i + 1;
                            const val = sheetToPrint.giorni[dayStr(d)]?.trasferta;
                            const out = d > daysInMonth;
                            return (
                              <td key={i} className={`p-0.5 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}>
                                {!out && val ? 'T' : ''}
                              </td>
                            );
                          })}
                          <td className="p-1 font-extrabold bg-gray-100">{formatDec(totals.ggTrasferta)} gg</td>
                        </tr>
                        <tr>
                          <td className="p-1 text-left bg-gray-50 border-r border-gray-955 font-extrabold">RIMBORSO KM (K)</td>
                          {Array.from({ length: 31 }).map((_, i) => {
                            const d = i + 1;
                            const val = sheetToPrint.giorni[dayStr(d)]?.rimborsoKm;
                            const out = d > daysInMonth;
                            return (
                              <td key={i} className={`p-0.5 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}>
                                {!out && val ? 'K' : ''}
                              </td>
                            );
                          })}
                          <td className="p-1 font-extrabold bg-gray-100">{formatDec(totals.ggRimborsoKm)} gg</td>
                        </tr>
                      </tbody>
                    </table>

                    {/* Dettagli in basso per Stampa */}
                    <div className="grid grid-cols-3 gap-3 pt-1.5 text-left text-[7px]">
                      {/* Note */}
                      <div className="border border-gray-400 p-2 rounded bg-gray-50">
                        <div className="font-extrabold text-[7.5px] border-b pb-1 text-gray-800 uppercase">Note Mensili:</div>
                        {sheetToPrint.noteDipendente ? (
                          <p className="mt-1 text-gray-800 whitespace-pre-line italic leading-normal">
                            "{sheetToPrint.noteDipendente}"
                          </p>
                        ) : (
                          <p className="mt-1 italic text-gray-500">
                            Nessuna nota mensile inserita.
                          </p>
                        )}
                      </div>

                      {/* Elenco Trasferte */}
                      <div className="border border-gray-400 p-2 rounded bg-gray-50">
                        <div className="font-extrabold text-[7.5px] border-b pb-1 text-gray-800 uppercase">Dettaglio Località Trasferte (T):</div>
                        {trasferte.length === 0 ? (
                          <p className="text-[6.5px] mt-1 italic text-gray-500">Nessuna trasferta effettuata nel mese.</p>
                        ) : (
                          <div className="grid grid-cols-1 gap-0.5 mt-1 text-[6.5px]">
                            {trasferte.map(tr => (
                              <div key={tr.giorno}>
                                <span className="font-bold">Giorno {tr.giorno}:</span> {tr.luogo || 'Località non specificata'}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Giustificativi e Note Giornaliere */}
                      <div className="border border-gray-400 p-2 rounded bg-gray-50">
                        <div className="font-extrabold text-[7.5px] border-b pb-1 text-gray-800 uppercase">Giustificativi e Note Giornaliere:</div>
                        {dailyNotes.length === 0 ? (
                          <p className="text-[6.5px] mt-1 italic text-gray-500">Nessuna nota giornaliera inserita.</p>
                        ) : (
                          <div className="space-y-0.5 mt-1 text-[6.5px]">
                            {dailyNotes.map(n => (
                              <div key={n.giorno}>
                                <span className="font-bold">Giorno {n.giorno}:</span> {n.note}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="border-t border-dashed border-gray-400 pt-3 mt-3 space-y-2">
                      <div className="text-[10px] font-extrabold uppercase border-b border-gray-900 pb-1 text-left">DICHIARAZIONE SPESE TRASFERTA E RIMBORSI</div>

                      <div className="text-[7.5px] font-semibold text-gray-955 leading-tight text-left">
                        DICHIARO di aver sostenuto le seguenti spese per trasferta nel periodo dal 01/{String(selectedMonth).padStart(2, '0')}/{selectedYear} al {daysInMonth}/{String(selectedMonth).padStart(2, '0')}/{selectedYear} per conto della società INGEGNO P&C S.R.L.
                      </div>

                      {/* Tabella Riepilogo Spese */}
                      <table className="w-full text-left border border-gray-900 border-collapse text-[7.5px]">
                        <thead>
                          <tr className="bg-gray-100 border-b border-gray-900 font-bold text-gray-900 uppercase">
                            <th className="p-1 border-r border-gray-900">Tipologia di spesa</th>
                            <th className="p-1 border-r border-gray-900 text-right w-36">Importo Euro</th>
                            <th className="p-1">Note</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-900 font-semibold text-gray-800">
                          <tr>
                            <td className="p-1 border-r border-gray-900">Spese di viaggio (aereo, nave, treno)</td>
                            <td className="p-1 border-r border-gray-900 text-right">{formatDec((sheetToPrint.rimborsoSpeseData?.speseViaggio || 0).toFixed(2))} €</td>
                            <td className="p-1">-</td>
                          </tr>
                          <tr>
                            <td className="p-1 border-r border-gray-900">Taxi / autobus / noleggio auto</td>
                            <td className="p-1 border-r border-gray-900 text-right">{formatDec((sheetToPrint.rimborsoSpeseData?.speseTaxiBus || 0).toFixed(2))} €</td>
                            <td className="p-1">-</td>
                          </tr>
                          <tr>
                            <td className="p-1 border-r border-gray-900">Parcheggi</td>
                            <td className="p-1 border-r border-gray-900 text-right">{formatDec((sheetToPrint.rimborsoSpeseData?.speseParcheggi || 0).toFixed(2))} €</td>
                            <td className="p-1">-</td>
                          </tr>
                          <tr>
                            <td className="p-1 border-r border-gray-900">Vitto</td>
                            <td className="p-1 border-r border-gray-900 text-right">{formatDec((sheetToPrint.rimborsoSpeseData?.speseVitto || 0).toFixed(2))} €</td>
                            <td className="p-1">-</td>
                          </tr>
                          <tr>
                            <td className="p-1 border-r border-gray-900">Alloggio</td>
                            <td className="p-1 border-r border-gray-900 text-right">{formatDec((sheetToPrint.rimborsoSpeseData?.speseAlloggio || 0).toFixed(2))} €</td>
                            <td className="p-1">-</td>
                          </tr>
                          <tr>
                            <td className="p-1 border-r border-gray-900">Pedaggi autostradali</td>
                            <td className="p-1 border-r border-gray-900 text-right">{formatDec((sheetToPrint.rimborsoSpeseData?.spesePedaggi || 0).toFixed(2))} €</td>
                            <td className="p-1">-</td>
                          </tr>
                          <tr>
                            <td className="p-1 border-r border-gray-900">Altro (specificare)</td>
                            <td className="p-1 border-r border-gray-900 text-right">{formatDec((sheetToPrint.rimborsoSpeseData?.speseAltro || 0).toFixed(2))} €</td>
                            <td className="p-1">{sheetToPrint.rimborsoSpeseData?.altroSpecificare || '-'}</td>
                          </tr>
                          <tr className="bg-gray-50 border-t-2 border-gray-900">
                            <td className="p-1 border-r border-gray-900">
                              Rimborso chilometrico per l'utilizzo del proprio automezzo
                              <div className="text-[7.5px] text-gray-500 font-bold mt-0.5">
                                Marca: {sheetToPrint.rimborsoSpeseData?.marcaAutomezzo || '_________________'} | 
                                Modello: {sheetToPrint.rimborsoSpeseData?.modelloAutomezzo || '_________________'}
                              </div>
                            </td>
                            <td className="p-1 border-r border-gray-900 text-right bg-gray-150 font-bold">
                              {formatDec(Object.values(sheetToPrint.giorni).reduce((sum, g) => sum + (g.kmTrasferta || 0), 0))} Km totali
                            </td>
                            <td className="p-1 text-gray-500 italic text-[7.5px] align-middle">
                              -
                            </td>
                          </tr>
                          <tr className="bg-gray-100 font-bold border-t-2 border-gray-900 text-[8px]">
                            <td className="p-1 border-r border-gray-900 uppercase">Totale altre spese sostenute (esclusi Km)</td>
                            <td className="p-1 border-r border-gray-900 text-right">
                              {formatDec(((sheetToPrint.rimborsoSpeseData?.speseViaggio || 0) +
                                (sheetToPrint.rimborsoSpeseData?.speseTaxiBus || 0) +
                                (sheetToPrint.rimborsoSpeseData?.speseParcheggi || 0) +
                                (sheetToPrint.rimborsoSpeseData?.speseVitto || 0) +
                                (sheetToPrint.rimborsoSpeseData?.speseAlloggio || 0) +
                                (sheetToPrint.rimborsoSpeseData?.spesePedaggi || 0) +
                                (sheetToPrint.rimborsoSpeseData?.speseAltro || 0)).toFixed(2))} €
                            </td>
                            <td className="p-1 text-[7.5px] font-medium text-gray-500 italic">Si allegano i relativi documenti di spesa.</td>
                          </tr>
                        </tbody>
                      </table>

                      {/* DETTAGLIO DELLE TRASFERTE E RIMBORSI KM EFFETTUATI */}
                      <div className="space-y-1.5 text-left">
                        <div className="text-[8px] font-extrabold uppercase border-b border-gray-300 pb-0.5">DETTAGLIO SPOSTAMENTI, TRASFERTE E RIMBORSI KM</div>
                        {trasferte.length === 0 ? (
                          <p className="text-[7px] text-gray-400 italic">Nessun giorno di trasferta o rimborso km segnato.</p>
                        ) : (
                          <table className="w-full text-left border border-gray-900 border-collapse text-[7px]">
                            <thead>
                              <tr className="bg-gray-100 border-b border-gray-900 font-bold text-gray-900 uppercase">
                                <th className="p-1 border-r border-gray-900 w-16">Data</th>
                                <th className="p-1 border-r border-gray-900 w-24">Tipo</th>
                                <th className="p-1 border-r border-gray-900">Tratte Spostamento (Partenza → Arrivo)</th>
                                <th className="p-1 border-r border-gray-900 w-32">Automezzo</th>
                                <th className="p-1 text-right w-16">Km Percorsi</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-900 font-semibold">
                              {trasferte.map(tr => {
                                const gPresenza = sheetToPrint.giorni[dayStr(tr.giorno)] || {};
                                const autoStr = [gPresenza.marcaAutomezzo, gPresenza.modelloAutomezzo].filter(Boolean).join(' ') || '-';
                                const tratteList = getTratteForGiorno(gPresenza).filter(t => t.partenza || t.arrivo);
                                const tratteStr = tratteList.length > 0
                                  ? tratteList.map((t, idx) => `Tratta ${idx + 1}: ${t.partenza || '?'} → ${t.arrivo || '?'}`).join(' | ')
                                  : '-';
                                return (
                                  <tr key={tr.giorno}>
                                    <td className="p-1 border-r border-gray-900">{String(tr.giorno).padStart(2, '0')}/{String(selectedMonth).padStart(2, '0')}/{selectedYear}</td>
                                    <td className="p-1 border-r border-gray-900 font-bold">
                                      {tr.trasferta ? 'Trasferta (T)' : 'Rimborso Km (K)'}
                                    </td>
                                    <td className="p-1 border-r border-gray-900">{tratteStr}</td>
                                    <td className="p-1 border-r border-gray-900">{autoStr}</td>
                                    <td className="p-1 text-right font-bold">{formatDec(gPresenza.kmTrasferta || 0)} km</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Header Logo */}
                    <div className="flex justify-between items-end pb-3 mb-1">
                      <img src="/Logo.png" alt="Logo Ingegno" className="h-10 w-auto object-contain" />
                      <div className="text-right text-[8px] font-bold text-gray-500 uppercase tracking-wider">
                        INGEGNO P&C S.R.L. · PROSPETTO DI FATTURAZIONE
                      </div>
                    </div>

                    {/* Dark Slate Header Band (Gray background as requested) */}
                    <div className="bg-gray-600 text-white p-3 rounded flex justify-between items-center mb-6 shadow-sm">
                      <span className="text-[10px] font-extrabold tracking-wider uppercase">PROSPETTO DI FATTURAZIONE (BOZZA)</span>
                      <span className="text-[10px] font-black tracking-wider uppercase bg-white/20 px-2 py-0.5 rounded">
                        {MESI[selectedMonth - 1]} {selectedYear}
                      </span>
                    </div>

                    {/* Info Box (Notary style, no gray background, larger employee name) */}
                    <div className="border border-gray-300 bg-white mb-6 text-[10px]">
                      <div className="p-3 space-y-1 text-left">
                        <span className="block text-[8px] font-bold text-gray-400 uppercase tracking-wider">COLLABORATORE</span>
                        <span className="block font-black text-gray-900 uppercase text-lg tracking-tight">{sheetToPrint.dipendenteNome}</span>
                        <span className="block text-gray-600 font-medium text-[9px]">{sheetToPrint.dipendenteEmail}</span>
                      </div>
                    </div>

                    {/* Invoice Table with strict borders (Fully white background) */}
                    <div className="border border-gray-300 mb-6 bg-white">
                      <table className="w-full text-left border-collapse text-[10px]">
                        <thead>
                          <tr className="bg-gray-100 border-b border-gray-300 font-bold text-gray-700 uppercase tracking-wider text-[8px]">
                            <th className="p-2.5 border-r border-gray-300">Descrizione della prestazione</th>
                            <th className="p-2.5 border-r border-gray-300 text-right w-44">Parametri</th>
                            <th className="p-2.5 text-right w-36">Importo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-300 font-medium text-gray-700 bg-white">
                          {sheetToPrint.collaboratoreData?.importoFissoMensile && Number(sheetToPrint.collaboratoreData.importoFissoMensile) > 0 ? (
                            <tr className="hover:bg-gray-50/20 bg-white">
                              <td className="p-2.5 border-r border-gray-300 text-left">
                                <span className="font-bold text-gray-900 block">Compenso mensile per servizi professionali</span>
                                <span className="text-[8px] text-gray-400 block mt-0.5">Servizi professionali a canone fisso per il mese di {MESI[selectedMonth - 1]} {selectedYear}</span>
                              </td>
                              <td className="p-2.5 border-r border-gray-300 text-right font-mono text-gray-500">-</td>
                              <td className="p-2.5 text-right font-bold text-gray-900">
                                {formatDec((Number(sheetToPrint.collaboratoreData.importoFissoMensile)).toFixed(2))} €
                              </td>
                            </tr>
                          ) : (
                            <tr className="hover:bg-gray-50/20 bg-white">
                              <td className="p-2.5 border-r border-gray-300 text-left">
                                <span className="font-bold text-gray-900 block">Compenso professionale</span>
                                <span className="text-[8px] text-gray-500 block mt-0.5">
                                  Prestazione professionale per servizi di consulenza basata su{' '}
                                  <strong className="text-gray-900 font-extrabold">
                                    {formatDec(sheetToPrint.collaboratoreData?.giornateOverride ?? sheetToPrint.collaboratoreData?.giornate ?? 0)} giornate lavorate
                                  </strong>
                                </span>
                              </td>
                              <td className="p-2.5 border-r border-gray-300 text-right font-mono text-gray-500">
                                {formatDec(sheetToPrint.collaboratoreData?.giornateOverride ?? sheetToPrint.collaboratoreData?.giornate ?? 0)} gg × {formatDec(sheetToPrint.collaboratoreData?.dailyRate ?? 0)} €/gg
                              </td>
                              <td className="p-2.5 text-right font-bold text-gray-900">
                                {formatDec((sheetToPrint.collaboratoreData?.compensoMensile ?? 0).toFixed(2))} €
                              </td>
                            </tr>
                          )}
                          
                          {sheetToPrint.collaboratoreData?.spese && sheetToPrint.collaboratoreData.spese > 0 ? (
                            <tr className="hover:bg-gray-50/20 bg-white">
                              <td className="p-2.5 border-r border-gray-300 text-left">
                                <span className="font-bold text-gray-900 block">Rimborso spese anticipate</span>
                                <span className="text-[8px] text-gray-400 block mt-0.5">Spese documentate anticipate per conto del committente</span>
                              </td>
                              <td className="p-2.5 border-r border-gray-300 text-right font-mono text-gray-500">-</td>
                              <td className="p-2.5 text-right font-bold text-gray-900">
                                {formatDec((sheetToPrint.collaboratoreData.spese).toFixed(2))} €
                              </td>
                            </tr>
                          ) : null}

                          {sheetToPrint.collaboratoreData?.km && sheetToPrint.collaboratoreData.km > 0 ? (
                            <tr className="hover:bg-gray-50/20 bg-white">
                              <td className="p-2.5 border-r border-gray-300 text-left">
                                <span className="font-bold text-gray-900 block">Rimborso spese chilometriche</span>
                                <span className="text-[8px] text-gray-400 block mt-0.5">
                                  Utilizzo automezzo proprio per trasferte ({sheetToPrint.rimborsoSpeseData?.marcaAutomezzo || ''} {sheetToPrint.rimborsoSpeseData?.modelloAutomezzo || ''})
                                </span>
                              </td>
                              <td className="p-2.5 border-r border-gray-300 text-right font-mono text-gray-500">
                                {formatDec(sheetToPrint.collaboratoreData.km)} km × {formatDec(sheetToPrint.collaboratoreData.kmRate ?? 0)} €/km
                              </td>
                              <td className="p-2.5 text-right font-bold text-gray-900">
                                {formatDec((sheetToPrint.collaboratoreData.rimborsoKm ?? 0).toFixed(2))} €
                              </td>
                            </tr>
                          ) : null}

                          {/* Subtotal Compenso */}
                          <tr className="bg-gray-50/80 font-bold border-t border-gray-300 text-[10px]">
                            <td className="p-2.5 border-r border-gray-300 text-gray-900 uppercase text-left">TOTALE COMPENSO (IMPONIBILE)</td>
                            <td className="p-2.5 border-r border-gray-300 text-right font-mono text-gray-500">-</td>
                            <td className="p-2.5 text-right text-gray-955 font-extrabold">
                              {formatDec((sheetToPrint.collaboratoreData?.totaleCompenso ?? 0).toFixed(2))} €
                            </td>
                          </tr>

                          {sheetToPrint.collaboratoreData?.inpsRate && sheetToPrint.collaboratoreData.inpsRate > 0 ? (
                            <tr className="hover:bg-gray-50/20 bg-white">
                              <td className="p-2.5 border-r border-gray-300 text-left">
                                <span className="font-bold text-gray-900 block">
                                  {sheetToPrint.collaboratoreData?.cassaLabel || 'Contributo cassa previdenziale'}
                                </span>
                                <span className="text-[8px] text-gray-400 block mt-0.5">
                                  {sheetToPrint.collaboratoreData?.cassaLabel 
                                    ? `Rivalsa ${sheetToPrint.collaboratoreData.cassaLabel}`
                                    : 'Rivalsa cassa previdenziale'}
                                </span>
                              </td>
                              <td className="p-2.5 border-r border-gray-300 text-right font-mono text-gray-500">
                                {formatDec(sheetToPrint.collaboratoreData.inpsRate)}%
                              </td>
                              <td className="p-2.5 text-right font-bold text-gray-900">
                                {formatDec((sheetToPrint.collaboratoreData.inps ?? 0).toFixed(2))} €
                              </td>
                            </tr>
                          ) : null}

                          {sheetToPrint.collaboratoreData?.ivaRate && sheetToPrint.collaboratoreData.ivaRate > 0 ? (
                            <tr className="hover:bg-gray-50/20 bg-white">
                              <td className="p-2.5 border-r border-gray-300 text-left">
                                <span className="font-bold text-gray-900 block">IVA</span>
                                <span className="text-[8px] text-gray-400 block mt-0.5">Imposta sul Valore Aggiunto</span>
                              </td>
                              <td className="p-2.5 border-r border-gray-300 text-right font-mono text-gray-500">
                                {formatDec(sheetToPrint.collaboratoreData.ivaRate)}%
                              </td>
                              <td className="p-2.5 text-right font-bold text-gray-900">
                                {formatDec((sheetToPrint.collaboratoreData.iva ?? 0).toFixed(2))} €
                              </td>
                            </tr>
                          ) : null}

                          {sheetToPrint.collaboratoreData?.raRate && sheetToPrint.collaboratoreData.raRate > 0 ? (
                            <tr className="hover:bg-gray-50/20 bg-white">
                              <td className="p-2.5 border-r border-gray-300 text-left">
                                <span className="font-bold text-gray-900 block">Ritenuta d'Acconto</span>
                                <span className="text-[8px] text-gray-400 block mt-0.5">Ritenuta d'acconto IRPEF</span>
                              </td>
                              <td className="p-2.5 border-r border-gray-300 text-right font-mono text-gray-500">
                                -{formatDec(sheetToPrint.collaboratoreData.raRate)}%
                              </td>
                              <td className="p-2.5 text-right font-bold text-red-655 font-extrabold">
                                - {formatDec((sheetToPrint.collaboratoreData.ra ?? 0).toFixed(2))} €
                              </td>
                            </tr>
                          ) : null}

                          {/* Final Total (Larger Net Due) */}
                          <tr className="bg-white font-bold border-t-2 border-gray-400 text-sm">
                            <td className="p-3 border-r border-gray-300 text-gray-900 uppercase text-left">TOTALE NETTO A PAGARE</td>
                            <td className="p-3 border-r border-gray-300 text-right font-mono text-gray-500">-</td>
                            <td className="p-3 text-right text-gray-950 font-black text-lg">
                              {formatDec((sheetToPrint.collaboratoreData?.totaleDovuto ?? 0).toFixed(2))} €
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Note Box (Fully white background) */}
                    <div className="border border-gray-300 p-4 bg-white text-[10px] text-left">
                      <div className="text-[8px] font-bold text-gray-400 uppercase tracking-wider mb-1">Note e specifiche del collaboratore</div>
                      {sheetToPrint.noteDipendente ? (
                        <p className="text-gray-700 whitespace-pre-line italic leading-relaxed">
                          "{sheetToPrint.noteDipendente}"
                        </p>
                      ) : (
                        <p className="text-gray-400 italic">Nessuna nota aggiuntiva inserita.</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          });
        })()}
      </div>
      {/* MODALE RICHIESTA MODIFICA / ANNULLAMENTO FESTIVO APPROVATO PER DIPENDENTE */}
      {modifyingWeekendReq && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-gray-150 p-6 flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <span>Richiedi Modifica / Annullamento</span>
              </h3>
              <button 
                onClick={() => setModifyingWeekendReq(null)} 
                className="text-gray-400 hover:text-gray-600 p-1 rounded-xl hover:bg-gray-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-indigo-50 border border-indigo-100 p-3.5 rounded-2xl text-xs space-y-1">
              <div className="font-extrabold text-indigo-950">
                Giorno Approvato: {formatDate(modifyingWeekendReq.data)}
              </div>
              <div className="text-indigo-700 italic">
                Motivo: {modifyingWeekendReq.motivo}
              </div>
            </div>

            <form onSubmit={handleRequestWeekendModificationSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5 ml-1">Tipo di Richiesta</label>
                <div className="grid grid-cols-2 gap-2 bg-gray-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setModWeekendTipo('annullamento')}
                    className={`py-2 text-xs font-bold rounded-lg transition cursor-pointer ${modWeekendTipo === 'annullamento' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                  >
                    Annulla Festivo
                  </button>
                  <button
                    type="button"
                    onClick={() => setModWeekendTipo('modifica')}
                    className={`py-2 text-xs font-bold rounded-lg transition cursor-pointer ${modWeekendTipo === 'modifica' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                  >
                    Sposta Data / Motivo
                  </button>
                </div>
              </div>

              {modWeekendTipo === 'modifica' && (
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">Nuova Data Desiderata</label>
                  <input
                    type="date"
                    required
                    min={(() => {
                      const d = new Date();
                      d.setDate(d.getDate() + 1);
                      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    })()}
                    value={modWeekendNuovaData}
                    onChange={e => setModWeekendNuovaData(e.target.value)}
                    className="w-full p-2.5 border border-gray-200 bg-gray-50 rounded-xl text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">
                  {modWeekendTipo === 'annullamento' ? 'Motivazione Annullamento (facoltativa)' : 'Nuova Motivazione / Note'}
                </label>
                <textarea
                  rows={2}
                  value={modWeekendMotivo}
                  onChange={e => setModWeekendMotivo(e.target.value)}
                  placeholder={modWeekendTipo === 'annullamento' ? "Es. Imprevisto personale, non posso lavorare..." : "Es. Spostato intervento in cantiere a domenica..."}
                  className="w-full p-2.5 border border-gray-200 bg-gray-50 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModifyingWeekendReq(null)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={modWeekendLoading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow transition disabled:opacity-50 cursor-pointer"
                >
                  {modWeekendLoading ? 'Invio in corso...' : 'Invia Richiesta all\'HR'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
