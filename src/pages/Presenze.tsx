import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, doc, setDoc, getDocs, query, where, addDoc, updateDoc, getDoc } from 'firebase/firestore';
import { FileText, Printer, Save, Send, CheckCircle, AlertCircle, Edit, MessageSquare, Clock, MapPin, Check, X, ShieldAlert, Download, RefreshCw } from 'lucide-react';
import { queueMail } from '../utils/mailSender';
import ConfirmModal from '../components/ConfirmModal';

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

const CHIUSURE_AZIENDALI = [
  { dataInizio: '2026-08-10', dataFine: '2026-08-14', label: 'Chiusura Estiva' }
];

export function isInChiusuraAziendale(dateStr: string): boolean {
  return CHIUSURE_AZIENDALI.some(c => dateStr >= c.dataInizio && dateStr <= c.dataFine);
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

interface GiornoPresenza {
  ore: number;
  straordinari: number;
  ferie: number;
  permessi: number;
  malattia: boolean;
  trasferta: boolean;
  luogoTrasferta?: string;
  noteGiorno?: string;
  itinerarioTrasferta?: string; // NEW
  kmTrasferta?: number; // NEW
}

interface RapportinoPresenze {
  id: string; // {dipendenteNome}-{anno}-{mese}
  dipendenteNome: string;
  dipendenteEmail: string;
  mese: number;
  anno: number;
  stato: 'Bozza' | 'Inviato' | 'Approvato' | 'Richiede Modifica';
  noteDipendente: string;
  noteHR: string;
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

const MESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

export default function Presenze() {
  const { user, isAdmin, isHR, myAssociatedName, dipendenti, refreshData } = useAuth();

  // queueEmailNotification rimossa a favore di queueMail centralizzata
  
  // Date Selection
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1); // 1-12
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  
  // Mode Selection: 'compila' (employee mode) or 'hr' (admin/hr dashboard)
  const [viewMode, setViewMode] = useState<'compila' | 'hr'>(() => {
    return (isHR || isAdmin) ? 'hr' : 'compila';
  });

  // State for Employee Mode
  const [rapportino, setRapportino] = useState<RapportinoPresenze | null>(null);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'ore' | 'spese' | 'weekend'>('ore');

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
  const [approvedLeaves, setApprovedLeaves] = useState<Record<string, { tipo: string; oraInizio?: string; oraFine?: string }>>({});
  const [reqWeekendData, setReqWeekendData] = useState('');
  const [reqWeekendMotivo, setReqWeekendMotivo] = useState('');
  const [reqWeekendLoading, setReqWeekendLoading] = useState(false);
  const [myWeekendRequests, setMyWeekendRequests] = useState<any[]>([]);
  const [allWeekendRequests, setAllWeekendRequests] = useState<any[]>([]);

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
    const dayOfWeek = new Date(selectedYear, selectedMonth - 1, dayNum).getDay();
    return dayOfWeek === 0 || dayOfWeek === 6; // 0 = Sunday, 6 = Saturday
  };

  const isDayLockedForUser = (dNum: number) => {
    const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
    if (approvedLeaves[dateStr]) {
      return true;
    }
    const isWk = isWeekend(dNum);
    const isChiusura = isInChiusuraAziendale(dateStr);
    return (isWk || isChiusura) && !approvedWeekends[dateStr];
  };

  // Convert 1-31 number to padded string
  const dayStr = (d: number) => String(d);
  // --- PREFILL LOGIC ---
  const createPrefilledRapportino = async () => {
    if (!myAssociatedName || !user?.email) return;

    try {
      // 1. Fetch approved requests from 'richieste_ferie'
      const qRichieste = query(
        collection(db, 'richieste_ferie'),
        where('dipendenteName', '==', myAssociatedName),
        where('stato', '==', 'Approvato')
      );

      const querySnap = await getDocs(qRichieste);
      const approvedAbsences: Record<string, { tipo: string; oraInizio?: string; oraFine?: string }> = {}; // YYYY-MM-DD -> data
      
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
                oraInizio: d.oraInizio,
                oraFine: d.oraFine
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
            trasferta: false
          };
          continue;
        }

        const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dateObj = new Date(selectedYear, selectedMonth - 1, day);
        const dayOfWeek = dateObj.getDay();
        const isWknd = dayOfWeek === 0 || dayOfWeek === 6;

        let ore = isWknd ? 0 : 8;
        let straordinari = 0;
        let ferie = 0;
        let permessi = 0;
        let malattia = false;
        let trasferta = false;

        // Apply approved absences (only on working days)
        if (approvedAbsences[dateStr] && !isWknd) {
          const abs = approvedAbsences[dateStr];
          if (abs.tipo === 'ferie') {
            ore = 0;
            ferie = 8;
          } else if (abs.tipo === 'malattia' || abs.tipo === 'maternita') {
            ore = 0;
            malattia = true;
          } else if (abs.tipo === 'mattina' || abs.tipo === 'pomeriggio') {
            ore = 4;
            permessi = 4;
          } else if (abs.tipo === 'smart') {
            ore = 8;
          } else if (abs.tipo === 'permesso') {
            let hrs = 4;
            if (abs.oraInizio && abs.oraFine) {
              const [hStart, mStart] = abs.oraInizio.split(':').map(Number);
              const [hEnd, mEnd] = abs.oraFine.split(':').map(Number);
              const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
              hrs = Math.round(diffMs / 3600000);
            }
            ore = Math.max(0, 8 - hrs);
            permessi = hrs;
          }
        }

        giorni[String(day)] = {
          ore,
          straordinari,
          ferie,
          permessi,
          malattia,
          trasferta
        };
      }

      // 3. Create document in Firestore
      const docId = `${myAssociatedName}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
      const docRef = doc(db, 'presenze', docId);

      const isCollab = isCollaboratore(myAssociatedName, dipendenti);
      const profile = dipendenti.find(d => d.nome.trim().toLowerCase() === myAssociatedName.trim().toLowerCase());
      const dailyRate = profile?.dailyRate ?? 0;
      const inpsRate = profile?.inpsRate ?? 0;
      const ivaRate = profile?.ivaRate ?? 0;
      const raRate = profile?.raRate ?? 0;

      let defaultGiornate = 0;
      for (let d = 1; d <= numDays; d++) {
        const dayOfWeek = new Date(selectedYear, selectedMonth - 1, d).getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          defaultGiornate++;
        }
      }

      const compensoMensile = defaultGiornate * dailyRate;
      const rimborsoKm = 0;
      const totaleCompenso = compensoMensile;
      const inps = compensoMensile * (inpsRate / 100);
      const iva = (compensoMensile + inps) * (ivaRate / 100);
      const ra = compensoMensile * (raRate / 100);
      const totaleDovuto = totaleCompenso + inps + iva - ra;

      const newRapportino: RapportinoPresenze = {
        id: docId,
        dipendenteNome: myAssociatedName,
        dipendenteEmail: user.email,
        mese: selectedMonth,
        anno: selectedYear,
        stato: 'Bozza',
        noteDipendente: '',
        noteHR: '',
        giorni,
        timestamp: new Date().toISOString()
      };

      if (isCollab) {
        newRapportino.collaboratoreData = {
          giornate: defaultGiornate,
          dailyRate,
          spese: 0,
          km: 0,
          kmRate: 0.3,
          inpsRate,
          ivaRate,
          raRate,
          compensoMensile,
          rimborsoKm,
          totaleCompenso,
          inps,
          iva,
          ra,
          totaleDovuto
        };
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
      if (viewMode === 'hr') {
        setLoadingHR(true);
        const [presSnap, wkSnap] = await Promise.all([
          getDocs(query(collection(db, 'presenze'), where('mese', '==', selectedMonth), where('anno', '==', selectedYear))),
          getDocs(collection(db, 'richieste_weekend'))
        ]);

        const dataMap: Record<string, RapportinoPresenze> = {};
        presSnap.forEach(docSnap => {
          dataMap[docSnap.id] = { id: docSnap.id, ...docSnap.data() } as RapportinoPresenze;
        });
        setAllRapportini(dataMap);

        if (reviewingRapportino) {
          const updated = dataMap[reviewingRapportino.id];
          if (updated) {
            setReviewingRapportino(updated);
          }
        }

        const listWk: any[] = [];
        wkSnap.forEach(docSnap => {
          listWk.push({ id: docSnap.id, ...docSnap.data() });
        });
        setAllWeekendRequests(listWk.sort((a, b) => b.timestamp?.localeCompare(a.timestamp || '') || b.data.localeCompare(a.data)));

        if (isHR) {
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

      if (viewMode === 'compila' && myAssociatedName) {
        setLoadingSheet(true);
        
        const startOfYear = `${selectedYear}-01-01`;
        const endOfYear = `${selectedYear}-12-31`;

        const [leavesSnap, docSnap, wkAppSnap, wkAllSnap] = await Promise.all([
          getDocs(query(
            collection(db, 'richieste_ferie'),
            where('dipendenteName', '==', myAssociatedName),
            where('stato', '==', 'Approvato'),
            where('dataInizio', '<=', endOfYear)
          )).catch(err => {
            console.error("Errore query ferie:", err);
            return null;
          }),
          getDoc(doc(db, 'presenze', `${myAssociatedName}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`)),
          getDocs(query(collection(db, 'richieste_weekend'), where('dipendenteName', '==', myAssociatedName), where('stato', '==', 'Approvato'))).catch(err => {
            console.error("Errore query weekend approvati:", err);
            return null;
          }),
          getDocs(query(collection(db, 'richieste_weekend'), where('dipendenteName', '==', myAssociatedName))).catch(err => {
            console.error("Errore query all weekend:", err);
            return null;
          })
        ]);

        const leaves: Record<string, { tipo: string; oraInizio?: string; oraFine?: string }> = {};
        if (leavesSnap) {
          leavesSnap.forEach(docSnap => {
            const d = docSnap.data();
            const start = d.dataInizio || d.data;
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
                    oraInizio: d.oraInizio,
                    oraFine: d.oraFine
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
          wkAllSnap.forEach(docSnap => {
            myWkList.push({ id: docSnap.id, ...docSnap.data() });
          });
        }
        setMyWeekendRequests(myWkList.sort((a, b) => b.data.localeCompare(a.data)));

        if (docSnap.exists()) {
          const data = docSnap.data() as RapportinoPresenze;
          const isCollab = isCollaboratore(myAssociatedName, dipendenti);
          
          if (isCollab && !data.collaboratoreData) {
            const profile = dipendenti.find(d => d.nome.trim().toLowerCase() === myAssociatedName.trim().toLowerCase());
            const dailyRate = profile?.dailyRate ?? 0;
            const inpsRate = profile?.inpsRate ?? 0;
            const ivaRate = profile?.ivaRate ?? 0;
            const raRate = profile?.raRate ?? 0;

            let defaultGiornate = 0;
            const daysInM = new Date(selectedYear, selectedMonth, 0).getDate();
            for (let d = 1; d <= daysInM; d++) {
              const dayOfWeek = new Date(selectedYear, selectedMonth - 1, d).getDay();
              if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                defaultGiornate++;
              }
            }

            const compensoMensile = defaultGiornate * dailyRate;
            const rimborsoKm = 0;
            const totaleCompenso = compensoMensile;
            const inps = compensoMensile * (inpsRate / 100);
            const iva = (compensoMensile + inps) * (ivaRate / 100);
            const ra = compensoMensile * (raRate / 100);
            const totaleDovuto = totaleCompenso + inps + iva - ra;

            data.collaboratoreData = {
              giornate: defaultGiornate,
              dailyRate,
              spese: 0,
              km: 0,
              kmRate: 0.3,
              inpsRate,
              ivaRate,
              raRate,
              compensoMensile,
              rimborsoKm,
              totaleCompenso,
              inps,
              iva,
              ra,
              totaleDovuto
            };
          } else if (isCollab && data.collaboratoreData) {
            const profile = dipendenti.find(d => d.nome.trim().toLowerCase() === myAssociatedName.trim().toLowerCase());
            if (profile) {
              let updated = false;
              const updatedData = { ...data.collaboratoreData };
              if ((!updatedData.dailyRate || updatedData.dailyRate === 0) && profile.dailyRate) {
                updatedData.dailyRate = profile.dailyRate;
                updated = true;
              }
              if ((!updatedData.inpsRate || updatedData.inpsRate === 0) && profile.inpsRate) {
                updatedData.inpsRate = profile.inpsRate;
                updated = true;
              }
              if ((!updatedData.ivaRate || updatedData.ivaRate === 0) && profile.ivaRate) {
                updatedData.ivaRate = profile.ivaRate;
                updated = true;
              }
              if ((!updatedData.raRate || updatedData.raRate === 0) && profile.raRate) {
                updatedData.raRate = profile.raRate;
                updated = true;
              }
              if (updated) {
                const compensoMensile = updatedData.giornate * updatedData.dailyRate;
                const rimborsoKm = updatedData.km * updatedData.kmRate;
                const totaleCompenso = compensoMensile + updatedData.spese + rimborsoKm;
                const inps = (compensoMensile + rimborsoKm) * (updatedData.inpsRate / 100);
                const iva = (compensoMensile + rimborsoKm + inps) * (updatedData.ivaRate / 100);
                const ra = (compensoMensile + rimborsoKm) * (updatedData.raRate / 100);
                const totaleDovuto = totaleCompenso + inps + iva - ra;
                data.collaboratoreData = {
                  ...updatedData,
                  compensoMensile,
                  rimborsoKm,
                  totaleCompenso,
                  inps,
                  iva,
                  ra,
                  totaleDovuto
                };
              }
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
          if (finalData.stato === 'Bozza' || finalData.stato === 'Richiede Modifica') {
            try {
              const updatedGiorni = { ...finalData.giorni };
              let hasChanges = false;
              const numDays = new Date(selectedYear, selectedMonth, 0).getDate();

              for (let day = 1; day <= 31; day++) {
                if (day > numDays) continue;

                const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dateObj = new Date(selectedYear, selectedMonth - 1, day);
                const dayOfWeek = dateObj.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                const currentDay = updatedGiorni[String(day)];
                if (!currentDay) continue;

                const abs = leaves[dateStr];
                if (abs) {
                  let targetOre = isWeekend ? 0 : 8;
                  let targetFerie = 0;
                  let targetPermessi = 0;
                  let targetMalattia = false;
                  let targetTrasferta = currentDay.trasferta;
                  let targetLuogoTrasferta = currentDay.luogoTrasferta || '';
                  let targetItinerarioTrasferta = currentDay.itinerarioTrasferta || '';
                  let targetKmTrasferta = currentDay.kmTrasferta || 0;
                  let targetStraordinari = currentDay.straordinari;
                  let targetNoteGiorno = currentDay.noteGiorno || '';

                  if (!isWeekend) {
                    if (abs.tipo === 'ferie') {
                      targetOre = 0;
                      targetFerie = 8;
                    } else if (abs.tipo === 'malattia' || abs.tipo === 'maternita') {
                      targetOre = 0;
                      targetMalattia = true;
                    } else if (abs.tipo === 'mattina' || abs.tipo === 'pomeriggio') {
                      targetOre = 4;
                      targetPermessi = 4;
                    } else if (abs.tipo === 'smart') {
                      targetOre = 8;
                    } else if (abs.tipo === 'permesso') {
                      let hrs = 4;
                      if (abs.oraInizio && abs.oraFine) {
                        const [hStart, mStart] = abs.oraInizio.split(':').map(Number);
                        const [hEnd, mEnd] = abs.oraFine.split(':').map(Number);
                        const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
                        hrs = Math.round(diffMs / 3600000);
                      }
                      targetOre = Math.max(0, 8 - hrs);
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
                    currentDay.ferie === 8 &&
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
                    currentDay.ore === 4 &&
                    currentDay.permessi === 4 &&
                    currentDay.straordinari === 0 &&
                    currentDay.ferie === 0 &&
                    !currentDay.malattia &&
                    !currentDay.trasferta;

                  const wasModifiedDueToAbsence = isCleanFerie || isCleanMalattia || isCleanPermesso;

                  if (wasModifiedDueToAbsence) {
                    updatedGiorni[String(day)] = {
                      ...currentDay,
                      ore: isWeekend ? 0 : 8,
                      ferie: 0,
                      permessi: 0,
                      malattia: false
                    };
                    hasChanges = true;
                  }
                }
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

    if (field === 'malattia') {
      currentDay.malattia = value;
      if (value) {
        currentDay.ore = 0;
        currentDay.ferie = 0;
        currentDay.permessi = 0;
        currentDay.straordinari = 0;
      } else {
        currentDay.ore = 8;
      }
    } else if (field === 'trasferta') {
      currentDay.trasferta = value;
      if (!value) {
        currentDay.luogoTrasferta = '';
      }
    } else {
      (currentDay as any)[field] = value;
    }

    updatedGiorni[day] = currentDay;
    setRapportino({ ...rapportino, giorni: updatedGiorni });
  };

  const handleCollabFieldChange = (field: string, value: number) => {
    if (!rapportino || !rapportino.collaboratoreData || rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato') return;

    const data = { ...rapportino.collaboratoreData };
    (data as any)[field] = value;

    const compensoMensile = data.giornate * data.dailyRate;
    const rimborsoKm = data.km * data.kmRate;
    const totaleCompenso = compensoMensile + data.spese + rimborsoKm;
    const inps = (compensoMensile + rimborsoKm) * (data.inpsRate / 100);
    const iva = (compensoMensile + rimborsoKm + inps) * (data.ivaRate / 100);
    const ra = (compensoMensile + rimborsoKm) * (data.raRate / 100);
    const totaleDovuto = totaleCompenso + inps + iva - ra;

    const updatedCollabData = {
      ...data,
      compensoMensile,
      rimborsoKm,
      totaleCompenso,
      inps,
      iva,
      ra,
      totaleDovuto
    };

    setRapportino({
      ...rapportino,
      collaboratoreData: updatedCollabData
    });
  };

  const handleReviewCollabFieldChange = (field: string, value: number) => {
    if (!reviewingRapportino || !reviewingRapportino.collaboratoreData) return;

    const data = { ...reviewingRapportino.collaboratoreData };
    (data as any)[field] = value;

    const compensoMensile = data.giornate * data.dailyRate;
    const rimborsoKm = data.km * data.kmRate;
    const totaleCompenso = compensoMensile + data.spese + rimborsoKm;
    const inps = (compensoMensile + rimborsoKm) * (data.inpsRate / 100);
    const iva = (compensoMensile + rimborsoKm + inps) * (data.ivaRate / 100);
    const ra = (compensoMensile + rimborsoKm) * (data.raRate / 100);
    const totaleDovuto = totaleCompenso + inps + iva - ra;

    const updatedCollabData = {
      ...data,
      compensoMensile,
      rimborsoKm,
      totaleCompenso,
      inps,
      iva,
      ra,
      totaleDovuto
    };

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
      altroSpecificare: '',
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
      altroSpecificare: '',
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
          raRate: collabData.raRate
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
    triggerConfirm(
      "Invio Rapportino",
      "Confermi l'invio del foglio presenze all'HR? Una volta inviato non potrai più modificarlo, a meno che non ti venga richiesto.",
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
          showToast("Foglio presenze inviato con successo all'HR!");
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
    if (!myAssociatedName || !user?.email) return;
    if (!reqWeekendData) {
      showToast("Seleziona una data!", "warning");
      return;
    }

    setReqWeekendLoading(true);
    try {
      await addDoc(collection(db, 'richieste_weekend'), {
        dipendenteName: myAssociatedName,
        dipendenteEmail: user.email,
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

  const handleWeekendDecision = async (id: string, approva: boolean) => {
    try {
      const req = allWeekendRequests.find(r => r.id === id);
      if (!req) return;
      
      const newStatus = approva ? 'Approvato' : 'Rifiutato';
      await updateDoc(doc(db, 'richieste_weekend', id), {
        stato: newStatus
      });
      loadPresenzeData();

      // Invia email al dipendente
      const targetDip = dipendenti.find(d => d.nome === req.dipendenteName);
      if (targetDip && targetDip.email) {
        const subject = `[Notifica] Autorizzazione lavoro straordinario ${newStatus}`;
        const htmlBody = `
          <p>Ciao <strong>${req.dipendenteName}</strong>,</p>
          <p>La tua richiesta di autorizzazione per lavorare il giorno <strong>${formatDate(req.data)}</strong> (${req.motivo}) è stata <strong>${newStatus.toLowerCase()}</strong>.</p>
          <p>Puoi procedere all'inserimento delle ore sul tuo foglio presenze se la richiesta è stata approvata.</p>
        `;
        const plainText = `Ciao ${req.dipendenteName},\n\nLa tua richiesta di autorizzazione per lavorare il giorno ${formatDate(req.data)} (${req.motivo}) è stata ${newStatus.toLowerCase()}.\n\nQuesta è una notifica automatica.`;
        await queueMail(targetDip.email.toLowerCase(), subject, htmlBody, plainText);
      }
      showToast(`Richiesta ${newStatus.toLowerCase()} con successo!`);
    } catch (e) {
      console.error("Errore decisione weekend:", e);
    }
  };

  // --- ACTIONS FOR HR / ADMIN ---
  const handleReviewCellChange = (day: string, field: keyof GiornoPresenza, value: any) => {
    if (!reviewingRapportino) return;

    const updatedGiorni = { ...reviewingRapportino.giorni };
    const currentDay = { ...updatedGiorni[day] };

    if (field === 'malattia') {
      currentDay.malattia = value;
      if (value) {
        currentDay.ore = 0;
        currentDay.ferie = 8;
        currentDay.permessi = 0;
        currentDay.straordinari = 0;
      }
    } else if (field === 'trasferta') {
      currentDay.trasferta = value;
      if (!value) {
        currentDay.luogoTrasferta = '';
      }
    } else {
      (currentDay as any)[field] = value;
    }

    updatedGiorni[day] = currentDay;
    setReviewingRapportino({ ...reviewingRapportino, giorni: updatedGiorni });
  };

  const handleHRApprove = () => {
    if (!reviewingRapportino) return;
    if (reviewingRapportino.stato === 'Bozza') {
      showToast("Impossibile approvare un rapportino in stato Bozza.", "warning");
      return;
    }
    triggerConfirm(
      "Approva Rapportino",
      `Approvare il foglio presenze di ${reviewingRapportino.dipendenteNome}?`,
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

          const isCollab = isCollaboratore(reviewingRapportino.dipendenteNome, dipendenti);
          if (isCollab && reviewingRapportino.collaboratoreData) {
            await saveCollabProfileRates(reviewingRapportino.collaboratoreData, reviewingRapportino.dipendenteNome);
          }

          setReviewingRapportino(null);
          showToast("Rapportino approvato!");
          loadPresenzeData();

          // Invia notifica al dipendente
          if (updated.dipendenteEmail) {
            const meseNome = MESI[selectedMonth - 1];
            await queueMail(
              updated.dipendenteEmail,
              `[Pianificazione] Rapportino Presenze Approvato - ${meseNome} ${selectedYear}`,
              `
                <p>Ciao <strong>${updated.dipendenteNome}</strong>,</p>
                <p>Il tuo rapportino presenze per il mese di <strong>${meseNome} ${selectedYear}</strong> è stato verificato ed <strong>approvato</strong> dall'amministrazione.</p>
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

      // Invia notifica al dipendente
      if (updated.dipendenteEmail) {
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
      const docRef = doc(db, 'presenze', reviewingRapportino.id);
      await setDoc(docRef, reviewingRapportino);

      const isCollab = isCollaboratore(reviewingRapportino.dipendenteNome, dipendenti);
      if (isCollab && reviewingRapportino.collaboratoreData) {
        await saveCollabProfileRates(reviewingRapportino.collaboratoreData, reviewingRapportino.dipendenteNome);
      }

      showToast("Modifiche salvate con successo!");
      loadPresenzeData();
    } catch (err) {
      console.error("Errore salvataggio modifiche HR:", err);
      showToast("Errore durante il salvataggio.", "error");
    }
  };

  // --- CALCULATION TOTALS FOR A SINGLE SHEET ---
  const calculateTotals = (giorni: { [giorno: string]: GiornoPresenza }, numDays: number) => {
    let oreOrd = 0;
    let oreStra = 0;
    let oreFerie = 0;
    let orePerm = 0;
    let ggMalattia = 0;
    let ggTrasferta = 0;
    let ggIntere = 0;
    let ggMezze = 0;

    for (let d = 1; d <= numDays; d++) {
      const g = giorni[String(d)];
      if (g) {
        oreOrd += Number(g.ore || 0);
        oreStra += Number(g.straordinari || 0);
        oreFerie += Number(g.ferie || 0);
        orePerm += Number(g.permessi || 0);
        if (g.malattia) ggMalattia++;
        if (g.trasferta) ggTrasferta++;

        if (g.ore === 8) ggIntere++;
        if (g.ore === 4) ggMezze++;
      }
    }

    return { oreOrd, oreStra, oreFerie, orePerm, ggMalattia, ggTrasferta, ggIntere, ggMezze };
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

      const activeList = dipendenti.filter(dip => {
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

      const activeList = dipendenti.filter(dip => {
        const isCollab = isCollaboratore(dip.nome, dipendenti);
        return isCollabExport ? isCollab : !isCollab;
      });

      const rows: string[][] = [];

      activeList.forEach(dip => {
        for (let m = 1; m <= 12; m++) {
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
      "Luogo Trasferta",
      "Itinerario (Tratta A/R)",
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
        g ? (g.luogoTrasferta || "") : "",
        g ? (g.itinerarioTrasferta || "") : "",
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

  const handlePrint = () => {
    if (selectedDipFilter) {
      const docId = `${selectedDipFilter}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
      const sheet = allRapportini[docId];
      if (!sheet) {
        showToast(`Nessun foglio presenze registrato per ${selectedDipFilter} in questo mese.`, "warning");
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
  const getStatusBadge = (stato: RapportinoPresenze['stato'] | 'Non Iniziato') => {
    switch (stato) {
      case 'Approvato':
        return <span className="flex items-center gap-1.5 text-xs font-bold bg-green-100 text-green-700 px-3 py-1 rounded-full"><CheckCircle className="w-3.5 h-3.5"/> Approvato</span>;
      case 'Inviato':
        return <span className="flex items-center gap-1.5 text-xs font-bold bg-blue-100 text-blue-700 px-3 py-1 rounded-full"><Clock className="w-3.5 h-3.5"/> Inviato</span>;
      case 'Richiede Modifica':
        return <span className="flex items-center gap-1.5 text-xs font-bold bg-orange-100 text-orange-700 px-3 py-1 rounded-full"><AlertCircle className="w-3.5 h-3.5"/> Da Correggere</span>;
      case 'Bozza':
        return <span className="flex items-center gap-1.5 text-xs font-bold bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full"><Edit className="w-3.5 h-3.5"/> Bozza</span>;
      default:
        return <span className="flex items-center gap-1.5 text-xs font-bold bg-gray-100 text-gray-500 px-3 py-1 rounded-full"><X className="w-3.5 h-3.5"/> Non Iniziato</span>;
    }
  };

  // --- PREPARE DATA FOR TRANSFER LIST ---
  const getTrasferteList = (giorni: { [giorno: string]: GiornoPresenza }, numDays: number) => {
    const list: { giorno: number; luogo: string }[] = [];
    for (let d = 1; d <= numDays; d++) {
      const g = giorni[String(d)];
      if (g && g.trasferta) {
        list.push({ giorno: d, luogo: g.luogoTrasferta || '' });
      }
    }
    return list;
  };

  // Calcolo dei conteggi per i badge interni (Dipendenti / Collaboratori) del mese selezionato
  const pendingDipCount = useMemo(() => {
    return dipendenti.filter(dip => {
      const isCollab = isCollaboratore(dip.nome, dipendenti);
      if (isCollab) return false;
      const docId = `${dip.nome}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
      const sheet = allRapportini[docId];
      return sheet?.stato === 'Inviato';
    }).length;
  }, [dipendenti, allRapportini, selectedYear, selectedMonth]);

  const pendingCollabCount = useMemo(() => {
    return dipendenti.filter(dip => {
      const isCollab = isCollaboratore(dip.nome, dipendenti);
      if (!isCollab) return false;
      const docId = `${dip.nome}-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
      const sheet = allRapportini[docId];
      return sheet?.stato === 'Inviato';
    }).length;
  }, [dipendenti, allRapportini, selectedYear, selectedMonth]);

  return (
    <div className="flex flex-col gap-6">
      
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
            <p className="text-xs text-gray-500 font-semibold mt-0.5">Gestione foglio ore e riepilogo mensile per amministrazione</p>
          </div>
        </div>

        {/* SWITCHER COMPILAZIONE / ADMIN SE HR O ADMIN */}
        {(isHR || isAdmin) && (
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
                📋 Foglio Ore
              </button>
              {!isCollaboratore(myAssociatedName, dipendenti) && (
                <button
                  type="button"
                  onClick={() => setActiveTab('spese')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'spese' ? 'bg-white text-indigo-600 shadow-sm font-extrabold' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  🚗 Nota Spese
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveTab('weekend')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'weekend' ? 'bg-white text-indigo-600 shadow-sm font-extrabold' : 'text-gray-500 hover:text-gray-700'}`}
              >
                🛡️ Weekend/Chiusure
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
                {dipendenti.map(d => (
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
              <Printer className="w-4 h-4" /> {selectedDipFilter ? "Stampa Foglio Ore" : "Stampa Tabella"}
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
              <span>Richieste Autorizzazione Weekend / Chiusure</span>
              {isHR && globalPendingWeekendCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-extrabold px-2 py-0.5 rounded-full">
                  {globalPendingWeekendCount}
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-500 font-semibold mb-6">
              Elenco delle richieste di dipendenti e collaboratori per lavorare nei giorni di weekend o chiusura aziendale.
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
                                onClick={() => handleWeekendDecision(req.id, true)} 
                                className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white font-bold rounded-lg text-[10px] shadow active:scale-95"
                              >
                                Approva
                              </button>
                              <button 
                                onClick={() => handleWeekendDecision(req.id, false)} 
                                className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white font-bold rounded-lg text-[10px] shadow active:scale-95"
                              >
                                Rifiuta
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
                {isHR && pendingDipCount > 0 && (
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
                {isHR && pendingCollabCount > 0 && (
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
              <div className="p-12 text-center text-gray-500 font-bold">Caricamento presenze in corso...</div>
            ) : dipendenti.length === 0 ? (
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
                      <th className="p-4 font-bold text-gray-700 text-sm text-center">Malattia/Maternità (Giorni)</th>
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
                  {dipendenti
                    .filter(dip => {
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
                        : { oreOrd: 0, oreStra: 0, oreFerie: 0, orePerm: 0, ggMalattia: 0, ggTrasferta: 0, ggIntere: 0, ggMezze: 0 };

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
                              <td className="p-4 text-right font-semibold text-gray-700">{totals.oreOrd}h</td>
                              <td className="p-4 text-right font-bold text-amber-600">{totals.oreStra > 0 ? `+${totals.oreStra}h` : '0h'}</td>
                              <td className="p-4 text-right font-semibold text-gray-700">{totals.oreFerie}h</td>
                              <td className="p-4 text-right font-semibold text-gray-700">{totals.orePerm}h</td>
                              <td className="p-4 text-center text-red-600 font-bold">{totals.ggMalattia > 0 ? totals.ggMalattia : '-'}</td>
                              <td className="p-4 text-center text-blue-600 font-bold">{totals.ggTrasferta > 0 ? totals.ggTrasferta : '-'}</td>
                            </>
                          ) : (
                            <>
                              <td className="p-4 text-right font-semibold text-gray-700">
                                {sheet?.collaboratoreData ? `${sheet.collaboratoreData.giornate} gg` : '-'}
                              </td>
                              <td className="p-4 text-right font-semibold text-gray-700">
                                {sheet?.collaboratoreData ? `${sheet.collaboratoreData.spese.toFixed(2)} €` : '-'}
                              </td>
                              <td className="p-4 text-right font-semibold text-gray-700">
                                {sheet?.collaboratoreData ? `${sheet.collaboratoreData.rimborsoKm.toFixed(2)} €` : '-'}
                              </td>
                              <td className="p-4 text-right font-bold text-indigo-600">
                                {sheet?.collaboratoreData ? `${sheet.collaboratoreData.totaleDovuto.toFixed(2)} €` : '-'}
                              </td>
                            </>
                          )}
                          <td className="p-4 text-center no-print">
                            {sheet ? (
                              <button 
                                onClick={() => {
                                  setReviewingRapportino(JSON.parse(JSON.stringify(sheet))); // clone object
                                }}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition active:scale-95"
                              >
                                Esamina
                              </button>
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
            <div className="bg-white p-10 rounded-[2rem] border text-center text-gray-500 font-bold">Caricamento foglio presenze in corso...</div>
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
                    Autorizzazione Lavoro Weekend e Chiusure Aziendali
                  </h3>
                  <p className="text-xs text-indigo-900/80 mb-5 leading-relaxed">
                    Per poter registrare ore di lavoro il sabato, la domenica o nei periodi di chiusura aziendale, devi inviare una richiesta preventiva all'HR. Una volta approvata, i giorni corrispondenti saranno sbloccati nel tuo tabellone presenze.
                  </p>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Form */}
                    <form onSubmit={handleRequestWeekendSubmit} className="space-y-4 bg-white/60 p-5 rounded-2xl border border-indigo-100">
                      <h4 className="text-sm font-bold text-indigo-900">Invia Nuova Richiesta</h4>
                      <div>
                        <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Giorno</label>
                        <input 
                          type="date"
                          required
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
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-gray-900">{formatDate(req.data)}</div>
                                <div className="text-[10px] text-gray-500 truncate" title={req.motivo}>{req.motivo}</div>
                              </div>
                              <div className="shrink-0">{getStatusBadge(req.stato)}</div>
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
                            <tr>
                              <td className="p-3 font-semibold">Giornate Lavorate</td>
                              <td className="p-3 text-right">
                                <input 
                                  type="number"
                                  step="any"
                                  min="0"
                                  disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                  value={rapportino.collaboratoreData.giornate}
                                  onChange={e => handleCollabFieldChange('giornate', Number(e.target.value))}
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
                              <td className="p-3 text-right text-gray-900">{rapportino.collaboratoreData.compensoMensile.toFixed(2)} €</td>
                            </tr>

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
                              <td className="p-3 text-right text-gray-900">{rapportino.collaboratoreData.spese.toFixed(2)} €</td>
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
                              <td className="p-3">Rimborso Chilometrico (Km × Tariffa)</td>
                              <td className="p-3 text-right">-</td>
                              <td className="p-3 text-right text-gray-900">{rapportino.collaboratoreData.rimborsoKm.toFixed(2)} €</td>
                            </tr>

                            {/* TOTAL COMPENSO */}
                            <tr className="bg-amber-100/30 text-sm font-extrabold border-y border-amber-200">
                              <td className="p-3 uppercase">Totale Compenso (Imponibile)</td>
                              <td className="p-3 text-right">-</td>
                              <td className="p-3 text-right text-amber-900">{rapportino.collaboratoreData.totaleCompenso.toFixed(2)} €</td>
                            </tr>

                            {/* TAX RATES */}
                            <tr>
                              <td className="p-3 font-semibold">Contributo Cassa INPS</td>
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
                              <td className="p-3 text-right text-gray-900">{rapportino.collaboratoreData.inps.toFixed(2)} €</td>
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
                              <td className="p-3 text-right text-gray-900">{rapportino.collaboratoreData.iva.toFixed(2)} €</td>
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
                              <td className="p-3 text-right text-red-655">- {rapportino.collaboratoreData.ra.toFixed(2)} €</td>
                            </tr>

                            {/* TOTAL DUE */}
                            <tr className="bg-amber-600/10 text-base font-black border-t-2 border-amber-600">
                              <td className="p-4 uppercase text-amber-950">TOTALE DOVUTO (A PAGARE)</td>
                              <td className="p-4 text-right">-</td>
                              <td className="p-4 text-right text-amber-900 text-lg font-black">{rapportino.collaboratoreData.totaleDovuto.toFixed(2)} €</td>
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
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-extrabold text-gray-400 uppercase tracking-wider mr-2">Legenda:</span>
                    <span className="flex items-center gap-1.5 text-xs font-bold text-gray-700 bg-white px-2.5 py-1 rounded-lg border shadow-sm"><span className="w-2.5 h-2.5 rounded-full bg-red-500"></span> Malattia (M)</span>
                    <span className="flex items-center gap-1.5 text-xs font-bold text-gray-700 bg-white px-2.5 py-1 rounded-lg border shadow-sm"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Trasferta (T)</span>
                    <span className="flex items-center gap-1.5 text-xs font-bold text-gray-500 bg-gray-200 px-2 py-0.5 rounded border text-[10px] font-mono">W</span> Fine Settimana
                  </div>
                  
                  <button onClick={() => window.print()} className="flex items-center gap-1.5 text-gray-700 hover:text-gray-900 font-extrabold text-xs bg-white border px-3 py-1.5 rounded-xl shadow-sm hover:shadow active:scale-95 transition-all">
                    <Printer className="w-3.5 h-3.5" /> Stampa Mio Foglio
                  </button>
                </div>

                {/* Griglia Fissa 1-31 */}
                <div className="w-full overflow-x-auto scrollbar-thin">
                  <table className="w-full text-center border-collapse min-w-[1200px] text-xs">
                    <thead>
                      <tr className="bg-gray-100 border-b border-gray-200 text-[10px] uppercase font-bold text-gray-600">
                        <th className="p-3 text-left w-36 font-extrabold text-gray-700 bg-gray-100 sticky left-0 z-10 border-r border-gray-200">Giorno</th>
                        {Array.from({ length: 31 }).map((_, i) => {
                          const dayNum = i + 1;
                          const outOfMonth = dayNum > daysInMonth;
                          const isWk = !outOfMonth && isWeekend(dayNum);

                          return (
                            <th 
                              key={i} 
                              className={`p-2 border-r border-gray-200 w-[2.8%] min-w-[34px] ${outOfMonth ? 'bg-gray-300/50 text-gray-400' : isWk ? 'bg-gray-200/80 text-gray-600' : 'text-gray-700'}`}
                            >
                              <div>{dayNum}</div>
                              {!outOfMonth && (
                                <div className="text-[8px] mt-0.5 opacity-60">
                                  {new Date(selectedYear, selectedMonth - 1, dayNum).toLocaleDateString('it-IT', { weekday: 'narrow' })}
                                </div>
                              )}
                            </th>
                          );
                        })}
                        <th className="p-3 font-extrabold text-gray-800 bg-gray-150 border-l-2 border-gray-300 w-16">TOT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 font-medium">
                      {isCollaboratore(myAssociatedName, dipendenti) ? (
                        <>
                          {/* COLLABORATORI RIGA 1: GIORNATA INTERA */}
                          <tr className="hover:bg-gray-50/50 transition-colors">
                            <td className="p-3 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10">Giornata Intera</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];

                              return (
                                <td key={i} className={`p-1.5 border-r border-gray-200 ${outOfMonth ? 'bg-gray-200/30' : isWeekend(d) ? 'bg-gray-100/40' : ''} align-middle`}>
                                  {!outOfMonth && giorno && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato' || isDayLockedForUser(d)}
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
                            <td className="p-3 font-bold text-gray-800 bg-gray-50 border-l-2 border-gray-300 text-sm">
                              {calculateTotals(rapportino.giorni, daysInMonth).ggIntere} gg
                            </td>
                          </tr>

                          {/* COLLABORATORI RIGA 2: MEZZA GIORNATA */}
                          <tr className="hover:bg-gray-50/50 transition-colors">
                            <td className="p-3 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10">Mezza Giornata</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];

                              return (
                                <td key={i} className={`p-1.5 border-r border-gray-200 ${outOfMonth ? 'bg-gray-200/30' : isWeekend(d) ? 'bg-gray-100/40' : ''} align-middle`}>
                                  {!outOfMonth && giorno && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato' || isDayLockedForUser(d)}
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
                            <td className="p-3 font-bold text-gray-800 bg-gray-50 border-l-2 border-gray-300 text-sm">
                              {calculateTotals(rapportino.giorni, daysInMonth).ggMezze} gg
                            </td>
                          </tr>

                          {/* COLLABORATORI RIGA 3: TRASFERTA */}
                          <tr className="hover:bg-gray-50/50 transition-colors">
                            <td className="p-3 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 flex items-center gap-1.5">
                              Trasferta <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1 py-0.5 rounded font-mono">T</span>
                            </td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];

                              return (
                                <td key={i} className={`p-1.5 border-r border-gray-200 ${outOfMonth ? 'bg-gray-200/30' : isWeekend(d) ? 'bg-gray-100/40' : ''} align-middle`}>
                                  {!outOfMonth && giorno && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato' || isDayLockedForUser(d)}
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
                            <td className="p-3 font-bold text-blue-600 bg-gray-50 border-l-2 border-gray-300 text-sm">
                              {calculateTotals(rapportino.giorni, daysInMonth).ggTrasferta} gg
                            </td>
                          </tr>
                        </>
                      ) : (
                        <>
                          {/* DIPENDENTI STANDARD RIGA 1: ORE ORDINARIE */}
                          <tr className="hover:bg-gray-50/50 transition-colors">
                            <td className="p-3 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10">Ore Ordinarie</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];

                              return (
                                <td key={i} className={`p-1.5 border-r border-gray-200 ${outOfMonth ? 'bg-gray-200/30' : isWeekend(d) ? 'bg-gray-100/40' : ''}`}>
                                  {!outOfMonth && giorno && (
                                    <input 
                                      type="number"
                                      min={0}
                                      max={24}
                                      disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato' || giorno.malattia || isDayLockedForUser(d)}
                                      value={giorno.ore === 0 ? '' : giorno.ore}
                                      onChange={e => handleCellChange(dayStr(d), 'ore', e.target.value === '' ? 0 : Number(e.target.value))}
                                      className="w-full text-center border-none p-1 rounded font-bold outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500 bg-transparent disabled:opacity-70 text-gray-900"
                                    />
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-3 font-bold text-gray-800 bg-gray-50 border-l-2 border-gray-300 text-sm">
                              {calculateTotals(rapportino.giorni, daysInMonth).oreOrd}
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 2: STRAORDINARI */}
                          <tr className="hover:bg-gray-50/50 transition-colors">
                            <td className="p-3 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10">Straordinari</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];

                              return (
                                <td key={i} className={`p-1.5 border-r border-gray-200 ${outOfMonth ? 'bg-gray-200/30' : isWeekend(d) ? 'bg-gray-100/40' : ''}`}>
                                  {!outOfMonth && giorno && (
                                    <input 
                                      type="number"
                                      min={0}
                                      max={24}
                                      disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato' || giorno.malattia || isDayLockedForUser(d)}
                                      value={giorno.straordinari === 0 ? '' : giorno.straordinari}
                                      onChange={e => handleCellChange(dayStr(d), 'straordinari', e.target.value === '' ? 0 : Number(e.target.value))}
                                      className="w-full text-center border-none p-1 rounded font-bold outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500 bg-transparent disabled:opacity-70 text-amber-600 font-extrabold"
                                    />
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-3 font-bold text-amber-600 bg-gray-50 border-l-2 border-gray-300 text-sm">
                              {calculateTotals(rapportino.giorni, daysInMonth).oreStra}
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 3: FERIE */}
                          <tr className="hover:bg-gray-50/50 transition-colors">
                            <td className="p-3 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10">Ferie</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];

                              return (
                                <td key={i} className={`p-1.5 border-r border-gray-200 ${outOfMonth ? 'bg-gray-200/30' : isWeekend(d) ? 'bg-gray-100/40' : ''}`}>
                                  {!outOfMonth && giorno && (
                                    <input 
                                      type="number"
                                      min={0}
                                      max={24}
                                      disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato' || giorno.malattia || isDayLockedForUser(d)}
                                      value={giorno.ferie === 0 ? '' : giorno.ferie}
                                      onChange={e => handleCellChange(dayStr(d), 'ferie', e.target.value === '' ? 0 : Number(e.target.value))}
                                      className="w-full text-center border-none p-1 rounded font-bold outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500 bg-transparent disabled:opacity-70 text-green-700"
                                    />
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-3 font-bold text-green-700 bg-gray-50 border-l-2 border-gray-300 text-sm">
                              {calculateTotals(rapportino.giorni, daysInMonth).oreFerie}
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 4: PERMESSI */}
                          <tr className="hover:bg-gray-50/50 transition-colors">
                            <td className="p-3 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10">Permessi</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];

                              return (
                                <td key={i} className={`p-1.5 border-r border-gray-200 ${outOfMonth ? 'bg-gray-200/30' : isWeekend(d) ? 'bg-gray-100/40' : ''}`}>
                                  {!outOfMonth && giorno && (
                                    <input 
                                      type="number"
                                      min={0}
                                      max={24}
                                      disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato' || giorno.malattia || isDayLockedForUser(d)}
                                      value={giorno.permessi === 0 ? '' : giorno.permessi}
                                      onChange={e => handleCellChange(dayStr(d), 'permessi', e.target.value === '' ? 0 : Number(e.target.value))}
                                      className="w-full text-center border-none p-1 rounded font-bold outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500 bg-transparent disabled:opacity-70 text-indigo-600"
                                    />
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-3 font-bold text-indigo-600 bg-gray-50 border-l-2 border-gray-300 text-sm">
                              {calculateTotals(rapportino.giorni, daysInMonth).orePerm}
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 5: CONTRASSEGNO MALATTIA */}
                          <tr className="hover:bg-gray-50/50 transition-colors">
                            <td className="p-3 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 flex items-center gap-1.5">
                              Malattia/Maternità <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1 py-0.5 rounded font-mono">M</span>
                            </td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];

                              return (
                                <td key={i} className={`p-1.5 border-r border-gray-200 ${outOfMonth ? 'bg-gray-200/30' : isWeekend(d) ? 'bg-gray-100/40' : ''} align-middle`}>
                                  {!outOfMonth && giorno && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                        checked={giorno.malattia || false}
                                        onChange={e => handleCellChange(dayStr(d), 'malattia', e.target.checked)}
                                        className="w-4 h-4 rounded text-red-500 focus:ring-red-400 cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {outOfMonth && <span className="text-[10px] text-gray-400">N/D</span>}
                                </td>
                              );
                            })}
                            <td className="p-3 font-bold text-red-600 bg-gray-50 border-l-2 border-gray-300 text-sm">
                              {calculateTotals(rapportino.giorni, daysInMonth).ggMalattia} gg
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 6: CONTRASSEGNO TRASFERTA */}
                          <tr className="hover:bg-gray-50/50 transition-colors">
                            <td className="p-3 text-left font-bold text-gray-800 bg-gray-50 border-r border-gray-200 sticky left-0 z-10 flex items-center gap-1.5">
                              Trasferta <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1 py-0.5 rounded font-mono">T</span>
                            </td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const outOfMonth = d > daysInMonth;
                              const giorno = rapportino.giorni[dayStr(d)];

                              return (
                                <td key={i} className={`p-1.5 border-r border-gray-200 ${outOfMonth ? 'bg-gray-200/30' : isWeekend(d) ? 'bg-gray-100/40' : ''} align-middle`}>
                                  {!outOfMonth && giorno && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato' || isDayLockedForUser(d)}
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
                            <td className="p-3 font-bold text-blue-600 bg-gray-50 border-l-2 border-gray-300 text-sm">
                              {calculateTotals(rapportino.giorni, daysInMonth).ggTrasferta} gg
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* DETTAGLIO LOCALITA TRASFERTE E NOTE IN BASSO */}
                <div className="p-6 bg-gray-50/50 border-t grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* Sezione Trasferte Dettagli */}
                  <div className="space-y-4">
                    <h4 className="font-extrabold text-sm text-gray-800 flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-blue-600" />
                      Dettaglio Località Trasferte del Mese
                    </h4>
                    
                    {getTrasferteList(rapportino.giorni, daysInMonth).length === 0 ? (
                      <p className="text-xs text-gray-400 italic font-medium p-2">Nessun giorno contrassegnato come trasferta nel tabellone.</p>
                    ) : (
                      <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                        {getTrasferteList(rapportino.giorni, daysInMonth).map(({ giorno, luogo }) => (
                          <div key={giorno} className="flex items-center gap-3 bg-white p-2 rounded-xl border shadow-sm">
                            <span className="text-xs font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded">Giorno {giorno}</span>
                            <input 
                              type="text"
                              placeholder="Località o cantiere (es. Milano)"
                              disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                              value={luogo}
                              onChange={e => handleCellChange(dayStr(giorno), 'luogoTrasferta', e.target.value)}
                              className="flex-1 p-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Note Dipendente ed Avvisi */}
                  <div className="space-y-4 border-l pl-0 md:pl-6 border-gray-200/60">
                    <div className="space-y-1.5">
                      <label className="block text-sm font-extrabold text-gray-800">
                        Note Dipendente
                      </label>
                      <p className="text-[10px] text-gray-500 leading-relaxed font-bold">
                        * NEL CASO DI MALATTIA O MATERNITÀ INDICARE NELLE NOTE IL N° DELL'ATTESTATO RILASCIATO DAL MEDICO.
                      </p>
                      <textarea
                        rows={3}
                        placeholder="Inserisci qui eventuali note di malattia, dettagli o segnalazioni..."
                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                        value={rapportino.noteDipendente || ''}
                        onChange={e => setRapportino({ ...rapportino, noteDipendente: e.target.value })}
                        className="w-full mt-2 p-3 text-xs border rounded-xl bg-white outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-medium"
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

          {activeTab === 'spese' && (
            <>
              {/* NOTA SPESE E RIMBORSO TRASFERTE PER DIPENDENTI */}
                <div className="bg-white rounded-[2rem] shadow-xl border overflow-hidden p-6 sm:p-8 space-y-6 no-print">
                  <div className="border-b pb-4">
                    <h4 className="font-extrabold text-lg text-gray-900">Nota Spese e Trasferte</h4>
                    <p className="text-xs text-gray-500 font-semibold">Compila i dati dell'automezzo, le spese sostenute e il dettaglio dei chilometri percorsi per le trasferte del mese.</p>
                  </div>

                  {/* Dati Veicolo */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Marca Automezzo</label>
                      <input 
                        type="text"
                        placeholder="Es. Fiat"
                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                        value={rapportino.rimborsoSpeseData?.marcaAutomezzo || ''}
                        onChange={e => handleRimborsoFieldChange('marcaAutomezzo', e.target.value)}
                        className="w-full p-2.5 border rounded-xl text-xs outline-none focus:border-indigo-400 font-bold text-gray-800"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Modello Automezzo</label>
                      <input 
                        type="text"
                        placeholder="Es. Panda"
                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                        value={rapportino.rimborsoSpeseData?.modelloAutomezzo || ''}
                        onChange={e => handleRimborsoFieldChange('modelloAutomezzo', e.target.value)}
                        className="w-full p-2.5 border rounded-xl text-xs outline-none focus:border-indigo-400 font-bold text-gray-800"
                      />
                    </div>
                  </div>

                  {/* Spese Varie */}
                  <div className="space-y-3">
                    <h5 className="text-xs font-extrabold text-gray-700 uppercase tracking-wider">Spese Varie Sostenute (€)</h5>
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
                          className="w-full p-2 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400"
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
                          className="w-full p-2 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400"
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
                          className="w-full p-2 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400"
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
                          className="w-full p-2 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400"
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
                          className="w-full p-2 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400"
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
                          className="w-full p-2 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400"
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
                          className="w-full p-2 border rounded-xl text-xs text-right font-bold outline-none focus:border-indigo-400"
                        />
                      </div>
                    </div>
                    {/* Altro Specificare */}
                    <div className="pt-1">
                      <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Specificare voce Altro (se valorizzata)</label>
                      <input 
                        type="text"
                        placeholder="Es. Acquisto materiale ufficio urgente"
                        disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                        value={rapportino.rimborsoSpeseData?.altroSpecificare || ''}
                        onChange={e => handleRimborsoFieldChange('altroSpecificare', e.target.value)}
                        className="w-full p-2.5 border rounded-xl text-xs outline-none focus:border-indigo-400 font-medium text-gray-800"
                      />
                    </div>
                  </div>

                  {/* Dettaglio Trasferte (Tratte e Km) */}
                  <div className="space-y-3">
                    <h5 className="text-xs font-extrabold text-gray-700 uppercase tracking-wider">Itinerari e Chilometri per Trasferta</h5>
                    {getTrasferteList(rapportino.giorni, daysInMonth).length === 0 ? (
                      <p className="text-xs text-gray-400 italic">Nessun giorno segnato in trasferta (T) nel tabellone presenze.</p>
                    ) : (
                      <div className="border rounded-2xl overflow-hidden shadow-inner bg-gray-50 max-h-80 overflow-y-auto scrollbar-thin">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-gray-100 border-b border-gray-200 uppercase font-bold text-gray-500 text-[10px]">
                              <th className="p-3 w-16">Giorno</th>
                              <th className="p-3">Destinazione</th>
                              <th className="p-3">Itinerario (Tratta A/R)</th>
                              <th className="p-3 w-32 text-right">Km Percorsi</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 font-semibold text-gray-700">
                            {getTrasferteList(rapportino.giorni, daysInMonth).map(({ giorno, luogo }) => {
                              const gPresenza = rapportino.giorni[dayStr(giorno)];
                              return (
                                <tr key={giorno}>
                                  <td className="p-3 font-bold">Gg {giorno}</td>
                                  <td className="p-3">
                                    <input 
                                      type="text"
                                      placeholder="Località (Milano, ecc.)"
                                      disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                      value={luogo}
                                      onChange={e => handleCellChange(dayStr(giorno), 'luogoTrasferta', e.target.value)}
                                      className="w-full p-1.5 border rounded bg-white text-xs"
                                    />
                                  </td>
                                  <td className="p-3">
                                    <input 
                                      type="text"
                                      placeholder="Sede - Destinazione - Sede"
                                      disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                      value={gPresenza.itinerarioTrasferta || ''}
                                      onChange={e => handleCellChange(dayStr(giorno), 'itinerarioTrasferta', e.target.value)}
                                      className="w-full p-1.5 border rounded bg-white text-xs"
                                    />
                                  </td>
                                  <td className="p-3 text-right">
                                    <input 
                                      type="number"
                                      min="0"
                                      disabled={rapportino.stato === 'Inviato' || rapportino.stato === 'Approvato'}
                                      value={gPresenza.kmTrasferta === 0 ? '' : gPresenza.kmTrasferta || ''}
                                      onChange={e => handleCellChange(dayStr(giorno), 'kmTrasferta', e.target.value === '' ? 0 : Number(e.target.value))}
                                      className="w-24 p-1.5 border rounded bg-white text-xs text-right font-bold"
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Riepilogo Totali */}
                  {(() => {
                    const rim = rapportino.rimborsoSpeseData;
                    const totalKm = Object.values(rapportino.giorni).reduce((sum, g) => sum + (g.kmTrasferta || 0), 0);
                    const totalAltreSpese = (rim?.speseViaggio || 0) + (rim?.speseTaxiBus || 0) + (rim?.speseParcheggi || 0) + (rim?.speseVitto || 0) + (rim?.speseAlloggio || 0) + (rim?.spesePedaggi || 0) + (rim?.speseAltro || 0);
                    return (
                      <div className="bg-indigo-50/40 p-5 rounded-2xl border border-indigo-100 flex flex-col sm:flex-row justify-between gap-4 font-bold text-gray-800 text-xs">
                        <div>
                          <div className="text-[10px] text-gray-500 font-extrabold uppercase">Distanza Totale</div>
                          <div className="text-lg font-black text-indigo-900 mt-1">{totalKm} Km</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-500 font-extrabold uppercase">Altre Spese Totali</div>
                          <div className="text-lg font-black text-indigo-900 mt-1">{totalAltreSpese.toFixed(2)} €</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-indigo-600 font-extrabold uppercase font-mono">Dati Automezzo logs</div>
                          <div className="text-xs text-gray-600 mt-1 leading-normal font-medium">
                            I Km percorsi verranno contabilizzati dal consulente del lavoro per il rimborso.
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* PULSANTI DI AZIONE PER TAB SPESE */}
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
      {reviewingRapportino && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 no-print overflow-y-auto">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-6xl xl:max-w-7xl overflow-hidden flex flex-col my-4 max-h-[92vh]">
            
            {/* Header Modal */}
            <div className="bg-gradient-to-r from-indigo-700 to-violet-800 p-5 flex justify-between items-center text-white shrink-0">
              <div>
                <h3 className="font-extrabold text-lg flex items-center gap-2">
                  <FileText className="w-5 h-5" /> 
                  Esamina Rapportino: {reviewingRapportino.dipendenteNome}
                </h3>
                <p className="text-[11px] opacity-80 font-bold mt-0.5">Mese: {MESI[selectedMonth-1]} {selectedYear} | Email: {reviewingRapportino.dipendenteEmail}</p>
              </div>
              <button 
                onClick={() => setReviewingRapportino(null)} 
                className="hover:bg-white/20 p-2 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Corpo Modal */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              
              {/* Stato Attuale e Note Dipendente */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-xl border flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-gray-500 font-bold uppercase">Stato del Fglio Ore</div>
                    <div className="mt-1 flex items-center gap-2">
                      {getStatusBadge(reviewingRapportino.stato)}
                      {reviewingRapportino.stato === 'Inviato' && reviewingRapportino.submittedAt && (
                        <span className="text-[10px] text-gray-400 font-medium">Inviato il: {new Date(reviewingRapportino.submittedAt).toLocaleDateString('it-IT')}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-xl border">
                  <div className="text-[10px] text-gray-500 font-bold uppercase">Note Dipendente</div>
                  <div className="mt-1 text-xs font-semibold text-gray-700 whitespace-pre-line italic">
                    {reviewingRapportino.noteDipendente ? `"${reviewingRapportino.noteDipendente}"` : "Nessuna nota inserita."}
                  </div>
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
                        <tr>
                          <td className="p-2.5 font-semibold">Giornate Lavorate</td>
                          <td className="p-2.5 text-right">
                            <input 
                              type="number"
                              step="any"
                              min="0"
                              disabled={reviewingRapportino.stato === 'Approvato'}
                              value={reviewingRapportino.collaboratoreData.giornate}
                              onChange={e => handleReviewCollabFieldChange('giornate', Number(e.target.value))}
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
                          <td className="p-2.5 text-right text-gray-900">{reviewingRapportino.collaboratoreData.compensoMensile.toFixed(2)} €</td>
                        </tr>

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
                          <td className="p-2.5 text-right text-gray-900">{reviewingRapportino.collaboratoreData.spese.toFixed(2)} €</td>
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
                          <td className="p-2.5 text-right text-gray-900">{reviewingRapportino.collaboratoreData.rimborsoKm.toFixed(2)} €</td>
                        </tr>

                        {/* TOTAL COMPENSO */}
                        <tr className="bg-amber-100/30 text-xs font-extrabold border-y border-amber-200">
                          <td className="p-2.5 uppercase">Totale Compenso (Imponibile)</td>
                          <td className="p-2.5 text-right">-</td>
                          <td className="p-2.5 text-right text-amber-900">{reviewingRapportino.collaboratoreData.totaleCompenso.toFixed(2)} €</td>
                        </tr>

                        {/* TAX RATES */}
                        <tr>
                          <td className="p-2.5 font-semibold">Contributo Cassa INPS</td>
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
                          <td className="p-2.5 text-right text-gray-900">{reviewingRapportino.collaboratoreData.inps.toFixed(2)} €</td>
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
                          <td className="p-2.5 text-right text-gray-900">{reviewingRapportino.collaboratoreData.iva.toFixed(2)} €</td>
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
                          <td className="p-2.5 text-right text-red-655">- {reviewingRapportino.collaboratoreData.ra.toFixed(2)} €</td>
                        </tr>

                        {/* TOTAL DUE */}
                        <tr className="bg-amber-600/10 text-xs font-black border-t-2 border-amber-600">
                          <td className="p-3 uppercase text-amber-950">TOTALE DOVUTO (A PAGARE)</td>
                          <td className="p-3 text-right">-</td>
                          <td className="p-3 text-right text-amber-900 text-sm font-black">{reviewingRapportino.collaboratoreData.totaleDovuto.toFixed(2)} €</td>
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
                          return (
                            <th 
                              key={i} 
                              className={`p-1.5 border-r w-[2.8%] ${out ? 'bg-gray-300/50 text-gray-400' : isWeekend(d) ? 'bg-gray-200/70 text-gray-600' : 'text-gray-700'}`}
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

                              return (
                                <td key={i} className={`p-1 border-r ${out ? 'bg-gray-100/30' : isWeekend(d) ? 'bg-gray-50/50' : ''} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        checked={g.ore === 8}
                                        onChange={e => {
                                          const val = e.target.checked ? 8 : 0;
                                          handleReviewCellChange(dayStr(d), 'ore', val);
                                        }}
                                        className="w-3.5 h-3.5 rounded text-indigo-600"
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

                              return (
                                <td key={i} className={`p-1 border-r ${out ? 'bg-gray-100/30' : isWeekend(d) ? 'bg-gray-50/50' : ''} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        checked={g.ore === 4}
                                        onChange={e => {
                                          const val = e.target.checked ? 4 : 0;
                                          handleReviewCellChange(dayStr(d), 'ore', val);
                                        }}
                                        className="w-3.5 h-3.5 rounded text-indigo-600"
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

                              return (
                                <td key={i} className={`p-1 border-r ${out ? 'bg-gray-100/30' : isWeekend(d) ? 'bg-gray-50/50' : ''} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        checked={g.trasferta || false}
                                        onChange={e => handleReviewCellChange(dayStr(d), 'trasferta', e.target.checked)}
                                        className="w-3.5 h-3.5 rounded text-blue-500"
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

                              return (
                                <td key={i} className={`p-1 border-r ${out ? 'bg-gray-100/30' : isWeekend(d) ? 'bg-gray-50/50' : ''}`}>
                                  {!out && g && (
                                    <input 
                                      type="number"
                                      disabled={g.malattia}
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
                              {calculateTotals(reviewingRapportino.giorni, daysInMonth).oreOrd}
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 2: STRAORDINARI */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Straord.</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];

                              return (
                                <td key={i} className={`p-1 border-r ${out ? 'bg-gray-100/30' : isWeekend(d) ? 'bg-gray-50/50' : ''}`}>
                                  {!out && g && (
                                    <input 
                                      type="number"
                                      disabled={g.malattia}
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
                              {calculateTotals(reviewingRapportino.giorni, daysInMonth).oreStra}
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 3: FERIE */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Ferie</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];

                              return (
                                <td key={i} className={`p-1 border-r ${out ? 'bg-gray-100/30' : isWeekend(d) ? 'bg-gray-50/50' : ''}`}>
                                  {!out && g && (
                                    <input 
                                      type="number"
                                      disabled={g.malattia}
                                      value={g.ferie === 0 ? '' : g.ferie}
                                      onChange={e => handleReviewCellChange(dayStr(d), 'ferie', e.target.value === '' ? 0 : Number(e.target.value))}
                                      className="w-full text-center bg-transparent border-none p-0.5 rounded font-bold text-green-700 outline-none focus:bg-gray-50"
                                    />
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-green-700 bg-gray-50 border-l">
                              {calculateTotals(reviewingRapportino.giorni, daysInMonth).oreFerie}
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 4: PERMESSI */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Permessi</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];

                              return (
                                <td key={i} className={`p-1 border-r ${out ? 'bg-gray-100/30' : isWeekend(d) ? 'bg-gray-50/50' : ''}`}>
                                  {!out && g && (
                                    <input 
                                      type="number"
                                      disabled={g.malattia}
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
                              {calculateTotals(reviewingRapportino.giorni, daysInMonth).orePerm}
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 5: CONTRASSEGNO MALATTIA */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Malattia/Maternità</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];

                              return (
                                <td key={i} className={`p-1 border-r ${out ? 'bg-gray-100/30' : isWeekend(d) ? 'bg-gray-50/50' : ''} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        checked={g.malattia || false}
                                        onChange={e => handleReviewCellChange(dayStr(d), 'malattia', e.target.checked)}
                                        className="w-3.5 h-3.5 text-red-500 rounded"
                                      />
                                    </div>
                                  )}
                                  {out && '-'}
                                </td>
                              );
                            })}
                            <td className="p-2 font-bold text-red-600 bg-gray-50 border-l">
                              {calculateTotals(reviewingRapportino.giorni, daysInMonth).ggMalattia} gg
                            </td>
                          </tr>

                          {/* DIPENDENTI STANDARD RIGA 6: CONTRASSEGNO TRASFERTA */}
                          <tr>
                            <td className="p-2 text-left font-bold bg-gray-50 border-r sticky left-0 z-10">Trasferta</td>
                            {Array.from({ length: 31 }).map((_, i) => {
                              const d = i + 1;
                              const out = d > daysInMonth;
                              const g = reviewingRapportino.giorni[dayStr(d)];

                              return (
                                <td key={i} className={`p-1 border-r ${out ? 'bg-gray-100/30' : isWeekend(d) ? 'bg-gray-50/50' : ''} align-middle`}>
                                  {!out && g && (
                                    <div className="flex justify-center items-center">
                                      <input 
                                        type="checkbox"
                                        checked={g.trasferta || false}
                                        onChange={e => handleReviewCellChange(dayStr(d), 'trasferta', e.target.checked)}
                                        className="w-3.5 h-3.5 text-blue-500 rounded"
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

                {/* Dettaglio Trasferte (Tratte e Km) */}
                <div className="space-y-3">
                  <h5 className="text-[10px] font-extrabold text-gray-700 uppercase tracking-wider">Itinerari e Chilometri per Trasferta</h5>
                  {getTrasferteList(reviewingRapportino.giorni, daysInMonth).length === 0 ? (
                    <p className="text-xs text-gray-400 italic">Nessun giorno segnato in trasferta (T) nel tabellone presenze.</p>
                  ) : (
                    <div className="border rounded-2xl overflow-hidden shadow-inner bg-gray-50 max-h-[250px] overflow-y-auto scrollbar-thin">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-gray-100 border-b border-gray-200 uppercase font-bold text-gray-500 text-[9px]">
                            <th className="p-2.5 w-16">Giorno</th>
                            <th className="p-2.5">Destinazione</th>
                            <th className="p-2.5">Itinerario (Tratta A/R)</th>
                            <th className="p-2.5 w-28 text-right">Km Percorsi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 font-semibold text-gray-700">
                          {getTrasferteList(reviewingRapportino.giorni, daysInMonth).map(({ giorno }) => {
                            const gPresenza = reviewingRapportino.giorni[dayStr(giorno)];
                            return (
                              <tr key={giorno}>
                                <td className="p-2 font-bold">Gg {giorno}</td>
                                <td className="p-2">
                                  <input 
                                    type="text"
                                    placeholder="Località (Milano, ecc.)"
                                    value={gPresenza.luogoTrasferta || ''}
                                    onChange={e => handleReviewCellChange(dayStr(giorno), 'luogoTrasferta', e.target.value)}
                                    className="w-full p-1.5 border rounded bg-white text-xs"
                                  />
                                </td>
                                <td className="p-2">
                                  <input 
                                    type="text"
                                    placeholder="Sede - Destinazione - Sede"
                                    value={gPresenza.itinerarioTrasferta || ''}
                                    onChange={e => handleReviewCellChange(dayStr(giorno), 'itinerarioTrasferta', e.target.value)}
                                    className="w-full p-1.5 border rounded bg-white text-xs"
                                  />
                                </td>
                                <td className="p-2 text-right">
                                  <input 
                                    type="number"
                                    min="0"
                                    value={gPresenza.kmTrasferta === 0 ? '' : gPresenza.kmTrasferta || ''}
                                    onChange={e => handleReviewCellChange(dayStr(giorno), 'kmTrasferta', e.target.value === '' ? 0 : Number(e.target.value))}
                                    className="w-24 p-1.5 border rounded bg-white text-xs text-right font-bold"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
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
                        <div className="text-base font-black text-indigo-900 mt-0.5">{totalAltreSpese.toFixed(2)} €</div>
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
              <div className="flex gap-2">
                <button 
                  onClick={handleHRSaveModifications}
                  className="px-4 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-xl text-xs transition active:scale-95"
                >
                  Salva Modifiche Ore
                </button>
              </div>

              <div className="flex gap-3">
                {/* Mostra "Richiedi Modifica" ed "Approva" solo se lo stato non è già Approvato */}
                {reviewingRapportino.stato !== 'Approvato' && (
                  <>
                    <button 
                      onClick={() => {
                        setHrFeedbackNote(reviewingRapportino.noteHR || '');
                        setIsFeedbackModalOpen(true);
                      }}
                      className="px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl text-xs transition shadow active:scale-95"
                    >
                      Richiedi Modifica
                    </button>
                    <button 
                      onClick={handleHRApprove}
                      disabled={reviewingRapportino.stato === 'Bozza'}
                      className={`px-5 py-2.5 font-bold rounded-xl text-xs transition active:scale-95 ${
                        reviewingRapportino.stato === 'Bozza'
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
                          : 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                      }`}
                      title={reviewingRapportino.stato === 'Bozza' ? "Non è possibile approvare un rapportino in stato Bozza" : undefined}
                    >
                      Approva Rapportino
                    </button>
                  </>
                )}
                {reviewingRapportino.stato === 'Approvato' && (
                  <div className="text-xs font-bold text-green-700 flex items-center gap-1.5 p-2 bg-green-50 rounded-lg">
                    <Check className="w-4 h-4"/> Già Approvato
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. MODAL DI RICHIESTA CORREZIONE/FEEDBACK (DA HR A UTENTE)  */}
      {/* ======================================================== */}
      {isFeedbackModalOpen && reviewingRapportino && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 no-print">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform scale-100 transition-all">
            <div className="bg-orange-600 p-4 text-white font-extrabold flex justify-between items-center">
              <span>Nota di correzione presenze</span>
              <button onClick={() => setIsFeedbackModalOpen(false)} className="hover:bg-white/20 p-1 rounded-full"><X className="w-5 h-5"/></button>
            </div>
            <form onSubmit={handleHRRequestChanges} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-2">
                  Specifica quali correzioni o documenti mancano (sarà visibile al dipendente):
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

      {/* ========================================== */}
      {/* 5. SEZIONE SEGRETA DI STAMPA PDF           */}
      {/* ========================================== */}
      {/* Questa sezione viene formattata specificamente per la stampa in A4 orizzontale */}
      <div className="hidden print:block print-container w-full h-full text-[9px] font-sans p-4">
        
        {/* Intestazione per la stampa di un singolo dipendente (modal recensito o dipendente stesso) */}
        {(() => {
          // Determina quale rapportino stampare: se HR sta recensendo qualcuno stampa quello, altrimenti il proprio
          const sheetToPrint = printTargetSheet || reviewingRapportino || (viewMode === 'compila' ? rapportino : null);
          if (!sheetToPrint) return <div className="text-center p-8 text-gray-400">Nessun foglio ore selezionato per la stampa.</div>;
          
          const totals = calculateTotals(sheetToPrint.giorni, daysInMonth);
          const trasferte = getTrasferteList(sheetToPrint.giorni, daysInMonth);
          const isCollab = isCollaboratore(sheetToPrint.dipendenteNome, dipendenti);

          return (
            <>
              <div className="space-y-6">
                
                {/* Intestazione Documento */}
                <div className="flex justify-between items-end border-b-2 border-gray-900 pb-2">
                  <div>
                    <div className="text-sm font-extrabold text-gray-900">INGEGNO P & C SRL</div>
                    <div className="text-[9px] text-gray-500">Pianificazione Presenze ed Ore Lavorate</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-extrabold text-gray-900">SCHEMA PRESENZE</div>
                    <div className="text-[10px] font-bold text-gray-800">
                      Mese: {MESI[selectedMonth - 1].toUpperCase()} {selectedYear}
                    </div>
                  </div>
                </div>

                {/* Dettagli Anagrafici */}
                <div className="grid grid-cols-2 gap-4 border border-gray-300 p-3 bg-gray-50 rounded">
                  <div>
                    <span className="font-extrabold text-gray-600">DIPENDENTE:</span>{' '}
                    <span className="font-extrabold text-gray-900 text-[10px] uppercase">{sheetToPrint.dipendenteNome}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-extrabold text-gray-600">EMAIL:</span>{' '}
                    <span className="font-semibold text-gray-900">{sheetToPrint.dipendenteEmail}</span>
                  </div>
                </div>

                {/* Tabellone Griglia 1-31 */}
                {isCollab ? (
                  // Print collaborator invoice layout
                  <div className="border border-gray-900 rounded-lg overflow-hidden max-w-xl mx-auto my-4 text-[9px] text-left bg-white">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-100 border-b border-gray-900 font-extrabold text-gray-900">
                          <th className="p-2 border-r border-gray-900">VOCE / DESCRIZIONE</th>
                          <th className="p-2 border-r border-gray-900 text-right">VALORE / PARAMETRO</th>
                          <th className="p-2 text-right">IMPORTO (€)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-900 font-semibold text-gray-900">
                        <tr>
                          <td className="p-2 border-r border-gray-900">Mese di Riferimento</td>
                          <td className="p-2 border-r border-gray-900 text-right capitalize">{MESI[selectedMonth - 1]} {selectedYear}</td>
                          <td className="p-2 text-right">-</td>
                        </tr>
                        <tr>
                          <td className="p-2 border-r border-gray-900">Giornate Lavorate</td>
                          <td className="p-2 border-r border-gray-900 text-right">{sheetToPrint.collaboratoreData?.giornate ?? 0} gg</td>
                          <td className="p-2 text-right">-</td>
                        </tr>
                        <tr>
                          <td className="p-2 border-r border-gray-900">Tariffa Giornaliera Contratto</td>
                          <td className="p-2 border-r border-gray-900 text-right">{sheetToPrint.collaboratoreData?.dailyRate ?? 0} €/gg</td>
                          <td className="p-2 text-right">-</td>
                        </tr>
                        <tr className="bg-gray-50 font-bold">
                          <td className="p-2 border-r border-gray-900">Compenso Mensile (Giornate × Tariffa)</td>
                          <td className="p-2 border-r border-gray-900 text-right">-</td>
                          <td className="p-2 text-right">{(sheetToPrint.collaboratoreData?.compensoMensile ?? 0).toFixed(2)} €</td>
                        </tr>
                        <tr>
                          <td className="p-2 border-r border-gray-900">Spese e Altri Rimborsi</td>
                          <td className="p-2 border-r border-gray-900 text-right">-</td>
                          <td className="p-2 text-right">{(sheetToPrint.collaboratoreData?.spese ?? 0).toFixed(2)} €</td>
                        </tr>
                        <tr>
                          <td className="p-2 border-r border-gray-900">Chilometri Percorsi</td>
                          <td className="p-2 border-r border-gray-900 text-right">{sheetToPrint.collaboratoreData?.km ?? 0} km</td>
                          <td className="p-2 text-right">-</td>
                        </tr>
                        <tr>
                          <td className="p-2 border-r border-gray-900">Tariffa Chilometrica (€/km)</td>
                          <td className="p-2 border-r border-gray-900 text-right">{sheetToPrint.collaboratoreData?.kmRate ?? 0} €/km</td>
                          <td className="p-2 text-right">-</td>
                        </tr>
                        <tr className="bg-gray-50 font-bold">
                          <td className="p-2 border-r border-gray-900">Rimborso Chilometrico (Km × Tariffa)</td>
                          <td className="p-2 border-r border-gray-900 text-right">-</td>
                          <td className="p-2 text-right">{(sheetToPrint.collaboratoreData?.rimborsoKm ?? 0).toFixed(2)} €</td>
                        </tr>
                        <tr className="bg-gray-100 font-extrabold border-y border-gray-900 text-[10px]">
                          <td className="p-2 border-r border-gray-900 uppercase">Totale Compenso (Imponibile)</td>
                          <td className="p-2 border-r border-gray-900 text-right">-</td>
                          <td className="p-2 text-right">{(sheetToPrint.collaboratoreData?.totaleCompenso ?? 0).toFixed(2)} €</td>
                        </tr>
                        <tr>
                          <td className="p-2 border-r border-gray-900">Contributo Cassa INPS ({sheetToPrint.collaboratoreData?.inpsRate ?? 0}%)</td>
                          <td className="p-2 border-r border-gray-900 text-right">-</td>
                          <td className="p-2 text-right">{(sheetToPrint.collaboratoreData?.inps ?? 0).toFixed(2)} €</td>
                        </tr>
                        <tr>
                          <td className="p-2 border-r border-gray-900">IVA ({sheetToPrint.collaboratoreData?.ivaRate ?? 0}%)</td>
                          <td className="p-2 border-r border-gray-950 text-right">-</td>
                          <td className="p-2 text-right">{(sheetToPrint.collaboratoreData?.iva ?? 0).toFixed(2)} €</td>
                        </tr>
                        <tr>
                          <td className="p-2 border-r border-gray-900">Ritenuta d'Acconto ({sheetToPrint.collaboratoreData?.raRate ?? 0}%)</td>
                          <td className="p-2 border-r border-gray-900 text-right">-</td>
                          <td className="p-2 text-right text-red-655">- {(sheetToPrint.collaboratoreData?.ra ?? 0).toFixed(2)} €</td>
                        </tr>
                        <tr className="bg-gray-200 font-extrabold text-[10px] border-t-2 border-gray-900">
                          <td className="p-2 border-r border-gray-900 uppercase">TOTALE DOVUTO (A PAGARE)</td>
                          <td className="p-2 border-r border-gray-900 text-right">-</td>
                          <td className="p-2 text-right">{(sheetToPrint.collaboratoreData?.totaleDovuto ?? 0).toFixed(2)} €</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                <table className="w-full text-center border border-gray-950 table-fixed">
                  <thead>
                    <tr className="bg-gray-150 border-b border-gray-955 font-bold text-gray-900 text-[8px]">
                      <th className="p-1.5 border-r border-gray-950 text-left w-[12%] font-extrabold">RIGA/GIORNO</th>
                      {Array.from({ length: 31 }).map((_, i) => (
                        <th key={i} className="p-1 border-r border-gray-950 w-[2.6%] font-extrabold">{i + 1}</th>
                      ))}
                      <th className="p-1.5 border-l border-gray-950 w-[6%] font-extrabold">TOT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-955 font-semibold text-gray-900">
                    <>
                      {/* DIPENDENTI STANDARD RIGA 1: ORE */}
                      <tr>
                        <td className="p-1.5 text-left bg-gray-50 border-r border-gray-955 font-extrabold">ORE</td>
                        {Array.from({ length: 31 }).map((_, i) => {
                          const d = i + 1;
                          const val = sheetToPrint.giorni[dayStr(d)]?.ore;
                          const out = d > daysInMonth;
                          return (
                            <td key={i} className={`p-1 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}>
                              {!out ? (val || 0) : ''}
                            </td>
                          );
                        })}
                        <td className="p-1.5 font-extrabold bg-gray-100">{totals.oreOrd}</td>
                      </tr>

                      {/* DIPENDENTI STANDARD RIGA 2: STRAORDINARI */}
                      <tr>
                        <td className="p-1.5 text-left bg-gray-50 border-r border-gray-955 font-extrabold">STRAORDINARI</td>
                        {Array.from({ length: 31 }).map((_, i) => {
                          const d = i + 1;
                          const val = sheetToPrint.giorni[dayStr(d)]?.straordinari;
                          const out = d > daysInMonth;
                          return (
                            <td key={i} className={`p-1 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}>
                              {!out ? (val || 0) : ''}
                            </td>
                          );
                        })}
                        <td className="p-1.5 font-extrabold bg-gray-100">{totals.oreStra}</td>
                      </tr>

                      {/* DIPENDENTI STANDARD RIGA 3: FERIE */}
                      <tr>
                        <td className="p-1.5 text-left bg-gray-50 border-r border-gray-955 font-extrabold">FERIE</td>
                        {Array.from({ length: 31 }).map((_, i) => {
                          const d = i + 1;
                          const val = sheetToPrint.giorni[dayStr(d)]?.ferie;
                          const out = d > daysInMonth;
                          return (
                            <td key={i} className={`p-1 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}>
                              {!out ? (val || 0) : ''}
                            </td>
                          );
                        })}
                        <td className="p-1.5 font-extrabold bg-gray-100">{totals.oreFerie}</td>
                      </tr>

                      {/* DIPENDENTI STANDARD RIGA 4: PERMESSI */}
                      <tr>
                        <td className="p-1.5 text-left bg-gray-50 border-r border-gray-955 font-extrabold">PERMESSI</td>
                        {Array.from({ length: 31 }).map((_, i) => {
                          const d = i + 1;
                          const val = sheetToPrint.giorni[dayStr(d)]?.permessi;
                          const out = d > daysInMonth;
                          return (
                            <td key={i} className={`p-1 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}>
                              {!out ? (val || 0) : ''}
                            </td>
                          );
                        })}
                        <td className="p-1.5 font-extrabold bg-gray-100">{totals.orePerm}</td>
                      </tr>

                      {/* DIPENDENTI STANDARD RIGA 5: MALATTIA */}
                      <tr>
                        <td className="p-1.5 text-left bg-gray-50 border-r border-gray-955 font-extrabold">MALATTIA (M)</td>
                        {Array.from({ length: 31 }).map((_, i) => {
                          const d = i + 1;
                          const val = sheetToPrint.giorni[dayStr(d)]?.malattia;
                          const out = d > daysInMonth;
                          return (
                            <td key={i} className={`p-1 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}>
                              {!out && val ? 'M' : ''}
                            </td>
                          );
                        })}
                        <td className="p-1.5 font-extrabold bg-gray-100">{totals.ggMalattia} gg</td>
                      </tr>

                      {/* DIPENDENTI STANDARD RIGA 6: TRASFERTA */}
                      <tr>
                        <td className="p-1.5 text-left bg-gray-50 border-r border-gray-955 font-extrabold">TRASFERTA (T)</td>
                        {Array.from({ length: 31 }).map((_, i) => {
                          const d = i + 1;
                          const val = sheetToPrint.giorni[dayStr(d)]?.trasferta;
                          const out = d > daysInMonth;
                          return (
                            <td key={i} className={`p-1 border-r border-gray-955 ${out ? 'bg-gray-300' : ''}`}>
                              {!out && val ? 'T' : ''}
                            </td>
                          );
                        })}
                        <td className="p-1.5 font-extrabold bg-gray-100">{totals.ggTrasferta} gg</td>
                      </tr>
                    </>
                  </tbody>
                </table>
                )}

                {/* Dettagli in basso per Stampa */}
                <div className="grid grid-cols-2 gap-6 pt-2">
                  {/* Note */}
                  <div className="border border-gray-400 p-2.5 rounded bg-gray-50">
                    <div className="font-extrabold text-[8px] border-b pb-1 text-gray-800 uppercase">Avvertenze e Note:</div>
                    <p className="text-[7.5px] mt-1 leading-normal text-gray-700">
                      * NEL CASO DI MALATTIA O MATERNITÀ SEGNARE (M) E INDICARE NELLE NOTE IL N° DI PROTOCOLLO DEL CERTIFICATO.
                    </p>
                    <p className="text-[8px] font-bold mt-2 text-gray-900 whitespace-pre-line italic">
                      Note inserite: {sheetToPrint.noteDipendente ? `"${sheetToPrint.noteDipendente}"` : 'nessuna nota.'}
                    </p>
                  </div>

                  {/* Elenco Trasferte */}
                  <div className="border border-gray-400 p-2.5 rounded bg-gray-50">
                    <div className="font-extrabold text-[8px] border-b pb-1 text-gray-800 uppercase">Dettaglio Località Trasferte (T):</div>
                    {trasferte.length === 0 ? (
                      <p className="text-[7.5px] mt-1 italic text-gray-500">Nessuna trasferta effettuata nel mese.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1 text-[7.5px]">
                        {trasferte.map(tr => (
                          <div key={tr.giorno}>
                            <span className="font-bold">Giorno {tr.giorno}:</span> {tr.luogo || 'Località non specificata'}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Firme per Accettazione */}
                <div className="grid grid-cols-2 gap-12 pt-12 text-[10px]">
                  <div className="text-center border-t border-gray-900 pt-1.5 max-w-[200px] mx-auto">
                    <div className="font-bold">Firma del Dipendente</div>
                    <div className="text-[8px] text-gray-400 mt-0.5">({sheetToPrint.dipendenteNome})</div>
                  </div>
                  <div className="text-center border-t border-gray-900 pt-1.5 max-w-[200px] mx-auto">
                    <div className="font-bold">Firma Direzione / HR</div>
                    <div className="text-[8px] text-gray-400 mt-0.5">
                      {sheetToPrint.stato === 'Approvato' ? `Approvato da: ${sheetToPrint.approvedBy}` : '(firma per approvazione)'}
                    </div>
                  </div>
                </div>

              </div>

              {/* Se dipendente standard, stampiamo la seconda pagina della Nota Spese */}
              {!isCollab && (
                <div className="break-before-page pt-8 space-y-6">
                  {/* Intestazione Nota Spese */}
                  <div className="flex justify-between items-end border-b-2 border-gray-900 pb-2">
                    <div>
                      <div className="text-sm font-extrabold text-gray-900">INGEGNO P & C SRL</div>
                      <div className="text-[9px] text-gray-500">Pianificazione Presenze ed Ore Lavorate</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-extrabold text-gray-950">DICHIARAZIONE SPESE TRASFERTA</div>
                      <div className="text-[10px] font-bold text-gray-800">
                        Mese: {MESI[selectedMonth - 1].toUpperCase()} {selectedYear}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs font-semibold text-gray-950 leading-normal">
                    DICHIARO di aver sostenuto le seguenti spese per trasferta nel periodo dal 01/{String(selectedMonth).padStart(2, '0')}/{selectedYear} al {daysInMonth}/{String(selectedMonth).padStart(2, '0')}/{selectedYear} per conto della società INGEGNO P&C S.R.L.
                  </div>

                  {/* Tabella Riepilogo Spese */}
                  <table className="w-full text-left border border-gray-900 border-collapse text-[10px]">
                    <thead>
                      <tr className="bg-gray-100 border-b border-gray-900 font-bold text-gray-900 uppercase">
                        <th className="p-2 border-r border-gray-900">Tipologia di spesa</th>
                        <th className="p-2 border-r border-gray-900 text-right w-36">Importo Euro</th>
                        <th className="p-2">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-900 font-semibold text-gray-800">
                      <tr>
                        <td className="p-2 border-r border-gray-900">Spese di viaggio (aereo, nave, treno)</td>
                        <td className="p-2 border-r border-gray-900 text-right">{(sheetToPrint.rimborsoSpeseData?.speseViaggio || 0).toFixed(2)} €</td>
                        <td className="p-2">-</td>
                      </tr>
                      <tr>
                        <td className="p-2 border-r border-gray-900">Taxi / autobus / noleggio auto</td>
                        <td className="p-2 border-r border-gray-900 text-right">{(sheetToPrint.rimborsoSpeseData?.speseTaxiBus || 0).toFixed(2)} €</td>
                        <td className="p-2">-</td>
                      </tr>
                      <tr>
                        <td className="p-2 border-r border-gray-900">Parcheggi</td>
                        <td className="p-2 border-r border-gray-900 text-right">{(sheetToPrint.rimborsoSpeseData?.speseParcheggi || 0).toFixed(2)} €</td>
                        <td className="p-2">-</td>
                      </tr>
                      <tr>
                        <td className="p-2 border-r border-gray-900">Vitto</td>
                        <td className="p-2 border-r border-gray-900 text-right">{(sheetToPrint.rimborsoSpeseData?.speseVitto || 0).toFixed(2)} €</td>
                        <td className="p-2">-</td>
                      </tr>
                      <tr>
                        <td className="p-2 border-r border-gray-900">Alloggio</td>
                        <td className="p-2 border-r border-gray-900 text-right">{(sheetToPrint.rimborsoSpeseData?.speseAlloggio || 0).toFixed(2)} €</td>
                        <td className="p-2">-</td>
                      </tr>
                      <tr>
                        <td className="p-2 border-r border-gray-900">Pedaggi autostradali</td>
                        <td className="p-2 border-r border-gray-900 text-right">{(sheetToPrint.rimborsoSpeseData?.spesePedaggi || 0).toFixed(2)} €</td>
                        <td className="p-2">-</td>
                      </tr>
                      <tr>
                        <td className="p-2 border-r border-gray-900">Altro (specificare)</td>
                        <td className="p-2 border-r border-gray-900 text-right">{(sheetToPrint.rimborsoSpeseData?.speseAltro || 0).toFixed(2)} €</td>
                        <td className="p-2">{sheetToPrint.rimborsoSpeseData?.altroSpecificare || '-'}</td>
                      </tr>
                      <tr className="bg-gray-50 border-t-2 border-gray-900">
                        <td className="p-2 border-r border-gray-900">
                          Rimborso chilometrico per l'utilizzo del proprio automezzo
                          <div className="text-[9px] text-gray-500 font-bold mt-0.5">
                            Marca: {sheetToPrint.rimborsoSpeseData?.marcaAutomezzo || '_________________'} | 
                            Modello: {sheetToPrint.rimborsoSpeseData?.modelloAutomezzo || '_________________'}
                          </div>
                        </td>
                        <td className="p-2 border-r border-gray-900 text-right bg-gray-150 font-bold">
                          {Object.values(sheetToPrint.giorni).reduce((sum, g) => sum + (g.kmTrasferta || 0), 0)} Km totali
                        </td>
                        <td className="p-2 text-gray-500 italic text-[9px] align-middle">
                          (Il rimborso km viene calcolato esternamente dalla consulente del lavoro)
                        </td>
                      </tr>
                      <tr className="bg-gray-100 font-bold border-t-2 border-gray-900 text-xs">
                        <td className="p-2 border-r border-gray-900 uppercase">Totale altre spese sostenute (esclusi Km)</td>
                        <td className="p-2 border-r border-gray-900 text-right">
                          {((sheetToPrint.rimborsoSpeseData?.speseViaggio || 0) +
                            (sheetToPrint.rimborsoSpeseData?.speseTaxiBus || 0) +
                            (sheetToPrint.rimborsoSpeseData?.speseParcheggi || 0) +
                            (sheetToPrint.rimborsoSpeseData?.speseVitto || 0) +
                            (sheetToPrint.rimborsoSpeseData?.speseAlloggio || 0) +
                            (sheetToPrint.rimborsoSpeseData?.spesePedaggi || 0) +
                            (sheetToPrint.rimborsoSpeseData?.speseAltro || 0)).toFixed(2)} €
                        </td>
                        <td className="p-2 text-[9px] font-medium text-gray-500 italic">Si allegano i relativi documenti di spesa.</td>
                      </tr>
                    </tbody>
                  </table>

                  {/* DETTAGLIO DELLE TRASFERTE EFFETTUATE */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-extrabold uppercase border-b border-gray-300 pb-1">DETTAGLIO DELLE TRASFERTE EFFETTUATE</div>
                    {trasferte.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">Nessun giorno di trasferta segnato.</p>
                    ) : (
                      <table className="w-full text-left border border-gray-900 border-collapse text-[9px]">
                        <thead>
                          <tr className="bg-gray-100 border-b border-gray-900 font-bold text-gray-900 uppercase">
                            <th className="p-2 border-r border-gray-900 w-24">Data</th>
                            <th className="p-2 border-r border-gray-900">Destinazione</th>
                            <th className="p-2 border-r border-gray-900">Itinerario della trasferta TRATTA A/R</th>
                            <th className="p-2 text-right w-24">Km Percorsi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-900 font-semibold">
                          {trasferte.map(tr => {
                            const gPresenza = sheetToPrint.giorni[dayStr(tr.giorno)];
                            return (
                              <tr key={tr.giorno}>
                                <td className="p-2 border-r border-gray-900">{String(tr.giorno).padStart(2, '0')}/{String(selectedMonth).padStart(2, '0')}/{selectedYear}</td>
                                <td className="p-2 border-r border-gray-900">{tr.luogo || '-'}</td>
                                <td className="p-2 border-r border-gray-900">{gPresenza?.itinerarioTrasferta || '-'}</td>
                                <td className="p-2 text-right">{gPresenza?.kmTrasferta || 0} km</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="flex justify-between pt-10 text-[10px]">
                    <div className="text-center max-w-[220px]">
                      <div className="border-t border-gray-950 pt-2 font-bold px-8">Firma del dichiarante</div>
                      <div className="text-[8px] text-gray-500 mt-1">({sheetToPrint.dipendenteNome})</div>
                    </div>
                    <div className="text-center max-w-[220px]">
                      <div className="border-t border-gray-950 pt-2 font-bold px-8">Verificato da (HR/Direzione)</div>
                      <div className="text-[8px] text-gray-500 mt-1">{sheetToPrint.stato === 'Approvato' ? `Approvato da: ${sheetToPrint.approvedBy}` : '______________________'}</div>
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>
      
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
    </div>
  );
}
