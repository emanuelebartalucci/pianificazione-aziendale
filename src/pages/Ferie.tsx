import { useState, useEffect, useMemo, memo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, doc, updateDoc, deleteDoc, query, where, getDocs } from 'firebase/firestore';
import { Calendar, CheckCircle, XCircle, Clock, ChevronLeft, ChevronRight, RefreshCw, Pencil, Trash2, AlertTriangle, X } from 'lucide-react';
import { queueMail } from '../utils/mailSender';
import { isItalianHoliday, isWeekend } from '../utils/date';
import { getPrintFooterHtml } from '../config/version';

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

interface RichiestaFerie {
  id: string;
  dipendenteName: string;
  data: string;
  tipo: string;
  stato: 'In attesa' | 'Approvato' | 'Rifiutato' | 'Richiesta Annullamento' | 'Richiesta Modifica';
  frazioneTipo?: 'mattina' | 'pomeriggio' | 'giornata' | 'orario';
  dataInizio?: string;
  dataFine?: string;
  oraInizio?: string;
  oraFine?: string;
  pausaPranzo?: boolean;
  pausaPranzoOre?: number;
  timestamp?: string;
  note?: string;
  comunicazioneId?: string;
  richiestaModifica?: {
    tipoAzione: 'annullamento' | 'modifica';
    nuovaDataInizio?: string;
    nuovaDataFine?: string;
    nuovaOraInizio?: string;
    nuovaOraFine?: string;
    nuovaFrazioneTipo?: 'mattina' | 'pomeriggio' | 'giornata' | 'orario';
    nuovoTipo?: string;
    motivazione?: string;
    dataRichiesta?: string;
  };
}

const TIME_OPTIONS = Array.from({ length: 48 }).map((_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
});

const PAUSA_PRANZO_OPTIONS = Array.from({ length: 8 }).map((_, i) => {
  const v = (i + 1) * 0.5;
  return { value: v.toFixed(1), label: `${v.toString().replace('.', ',')} or${v === 1 ? 'a' : 'e'}` };
});

interface FerieContentProps {
  isHR: boolean;
  isAdmin: boolean;
  myAssociatedName: string;
  dipendenti: any[];
}

const FerieContent = memo(({ isHR, isAdmin, myAssociatedName, dipendenti }: FerieContentProps) => {
  const { userEmail } = useAuth();
  const [viewMode, setViewMode] = useState<'calendario' | 'tabella'>('calendario');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' | 'info' } | null>(null);
  const [chiusureAziendali, setChiusureAziendali] = useState<Array<{ dataInizio: string; dataFine: string }>>([]);

  const isInChiusuraAziendaleLocal = (dateStr: string) => {
    return chiusureAziendali.some(c => dateStr >= c.dataInizio && dateStr <= c.dataFine);
  };

  const showToast = (message: string, type: 'success' | 'warning' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  // State per la nuova richiesta
  const [requestMode, setRequestMode] = useState<'singolo' | 'range'>('singolo');
  const [dipendenteSelezionato, setDipendenteSelezionato] = useState(myAssociatedName || '');
  const [dataRichiesta, setDataRichiesta] = useState('');
  const [dataInizio, setDataInizio] = useState('');
  const [dataFine, setDataFine] = useState('');
  const [oraInizio, setOraInizio] = useState('09:00');
  const [oraFine, setOraFine] = useState('18:00');
  const [tipoRichiesta, setTipoRichiesta] = useState('ferie');
  const [frazioneTipo, setFrazioneTipo] = useState<'mattina' | 'pomeriggio' | 'giornata' | 'orario'>('giornata');
  const [approvedWeekends, setApprovedWeekends] = useState<Record<string, boolean>>({});
  const [pausaPranzo, setPausaPranzo] = useState(false);
  const [pausaPranzoOre, setPausaPranzoOre] = useState('1.0');

  useEffect(() => {
    if (myAssociatedName && !dipendenteSelezionato) {
      setDipendenteSelezionato(myAssociatedName);
    }
  }, [myAssociatedName]);

  const targetDipName = (isHR || isAdmin) ? (dipendenteSelezionato || myAssociatedName) : myAssociatedName;
  const targetDipObj = (dipendenti || []).find(d => d.nome === targetDipName);
  const isCollaboratore = targetDipObj?.tipo === 'collaboratore';

  useEffect(() => {
    if (isCollaboratore && (tipoRichiesta === 'ferie' || tipoRichiesta === 'permesso' || tipoRichiesta === 'studio' || tipoRichiesta === 'donazione' || tipoRichiesta === 'elettorale')) {
      setTipoRichiesta('assenza');
    }
  }, [isCollaboratore, tipoRichiesta]);
  
  // State per calendario
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  // Liste richieste suddivise per ottimizzazione letture
  const [myRichieste, setMyRichieste] = useState<RichiestaFerie[]>([]);
  const [othersApprovedRichieste, setOthersApprovedRichieste] = useState<RichiestaFerie[]>([]);
  const [hrRichieste, setHrRichieste] = useState<RichiestaFerie[]>([]);
  const [loading, setLoading] = useState(false);

  // States per l'annullamento ferie da parte di HR
  const [cancellationRequest, setCancellationRequest] = useState<RichiestaFerie | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancellationLoading, setCancellationLoading] = useState(false);

  // States per richiesta modifica / annullamento da parte del dipendente
  const [modifyingRequest, setModifyingRequest] = useState<RichiestaFerie | null>(null);
  const [modTipoAzione, setModTipoAzione] = useState<'annullamento' | 'modifica'>('annullamento');
  const [modDataInizio, setModDataInizio] = useState('');
  const [modDataFine, setModDataFine] = useState('');
  const [modOraInizio, setModOraInizio] = useState('09:00');
  const [modOraFine, setModOraFine] = useState('18:00');
  const [modFrazioneTipo, setModFrazioneTipo] = useState<'mattina' | 'pomeriggio' | 'giornata' | 'orario'>('giornata');
  const [modTipo, setModTipo] = useState('ferie');
  const [modMotivazione, setModMotivazione] = useState('');
  const [modLoading, setModLoading] = useState(false);

  // States per il filtraggio della lista richieste
  const [requestTab, setRequestTab] = useState<'tutte' | 'in_attesa' | 'approvate' | 'storico'>('tutte');

  const loadFerieData = async () => {
    try {
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

      const collaboratoriNames = new Set(
        (dipendenti || [])
          .filter(d => d.tipo === 'collaboratore')
          .map(d => (d.nome || '').toLowerCase().trim())
      );

      const mapRequestTipo = (dipName: string, docId: string, currentTipo: string) => {
        const normName = (dipName || '').toLowerCase().trim();
        if (collaboratoriNames.has(normName) && (currentTipo === 'ferie' || currentTipo === 'permesso')) {
          updateDoc(doc(db, 'richieste_ferie', docId), { tipo: 'assenza' }).catch(() => {});
          return 'assenza';
        }
        return currentTipo;
      };

      if (isHR || isAdmin) {
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        const startLimit = twoYearsAgo.toLocaleDateString('sv-SE');

        const q = query(
          collection(db, 'richieste_ferie'),
          where('dataFine', '>=', startLimit)
        );
        const snapshot = await getDocs(q);
        const list: RichiestaFerie[] = [];
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          list.push({
            id: docSnap.id,
            dipendenteName: data.dipendenteName,
            data: data.data || '',
            tipo: mapRequestTipo(data.dipendenteName, docSnap.id, data.tipo),
            stato: data.stato || 'In attesa',
            frazioneTipo: data.frazioneTipo,
            dataInizio: data.dataInizio,
            dataFine: data.dataFine,
            oraInizio: data.oraInizio,
            oraFine: data.oraFine,
            timestamp: data.timestamp,
            note: data.note || '',
            comunicazioneId: data.comunicazioneId || '',
            pausaPranzo: data.pausaPranzo || false,
            pausaPranzoOre: data.pausaPranzoOre || 0,
            richiestaModifica: data.richiestaModifica || null
          });
        });
        setHrRichieste(list);
      }

      if (myAssociatedName) {
        const qMy = query(
          collection(db, 'richieste_ferie'),
          where('dipendenteName', '==', myAssociatedName)
        );
        const mySnap = await getDocs(qMy);
        const listMy: RichiestaFerie[] = [];
        mySnap.forEach(docSnap => {
          const data = docSnap.data();
          listMy.push({
            id: docSnap.id,
            dipendenteName: data.dipendenteName,
            data: data.data || '',
            tipo: mapRequestTipo(data.dipendenteName, docSnap.id, data.tipo),
            stato: data.stato || 'In attesa',
            frazioneTipo: data.frazioneTipo,
            dataInizio: data.dataInizio,
            dataFine: data.dataFine,
            oraInizio: data.oraInizio,
            oraFine: data.oraFine,
            timestamp: data.timestamp,
            note: data.note || '',
            comunicazioneId: data.comunicazioneId || '',
            pausaPranzo: data.pausaPranzo || false,
            pausaPranzoOre: data.pausaPranzoOre || 0,
            richiestaModifica: data.richiestaModifica || null
          });
        });
        setMyRichieste(listMy);

        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        const startLimitOthers = sixtyDaysAgo.toLocaleDateString('sv-SE');

        const qOthers = query(
          collection(db, 'richieste_ferie'),
          where('dataFine', '>=', startLimitOthers)
        );
        const othersSnap = await getDocs(qOthers);
        const listOthers: RichiestaFerie[] = [];
        othersSnap.forEach(docSnap => {
          const data = docSnap.data();
          if (data.stato !== 'Approvato') return;
          if (data.dipendenteName === myAssociatedName) return;
          listOthers.push({
            id: docSnap.id,
            dipendenteName: data.dipendenteName,
            data: data.data || '',
            tipo: mapRequestTipo(data.dipendenteName, docSnap.id, data.tipo),
            stato: data.stato || 'In attesa',
            frazioneTipo: data.frazioneTipo,
            dataInizio: data.dataInizio,
            dataFine: data.dataFine,
            oraInizio: data.oraInizio,
            oraFine: data.oraFine,
            timestamp: data.timestamp,
            note: data.note || '',
            comunicazioneId: data.comunicazioneId || '',
            pausaPranzo: data.pausaPranzo || false,
            pausaPranzoOre: data.pausaPranzoOre || 0,
            richiestaModifica: data.richiestaModifica || null
          });
        });
        setOthersApprovedRichieste(listOthers);
      }

      // Carica autorizzazioni weekend approvate per tutti
      const wkSnap = await getDocs(query(
        collection(db, 'richieste_weekend'),
        where('stato', '==', 'Approvato')
      )).catch(err => {
        console.error("Errore query weekend:", err);
        return null;
      });
      const wkMap: Record<string, boolean> = {};
      if (wkSnap) {
        wkSnap.forEach(docSnap => {
          const d = docSnap.data();
          if (d.dipendenteName && d.data) {
            wkMap[`${d.dipendenteName}_${d.data}`] = true;
          }
        });
      }
      setApprovedWeekends(wkMap);
    } catch (err) {
      console.error("Error loading ferie data:", err);
      showToast("Errore nel caricamento delle ferie.", "error");
    }
  };

  useEffect(() => {
    loadFerieData();
  }, [myAssociatedName, isHR, isAdmin]);

  // Union list for regular users
  const requestsList = useMemo(() => {
    const map: Record<string, RichiestaFerie> = {};
    myRichieste.forEach(r => { map[r.id] = r; });
    othersApprovedRichieste.forEach(r => { map[r.id] = r; });
    return Object.values(map);
  }, [myRichieste, othersApprovedRichieste]);

  // Sorted full list depending on role
  const richieste = useMemo(() => {
    const list = (isHR || isAdmin) ? hrRichieste : requestsList;
    return list.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : new Date(a.dataInizio || a.data).getTime();
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : new Date(b.dataInizio || b.data).getTime();
      return timeB - timeA;
    });
  }, [hrRichieste, requestsList, isHR, isAdmin]);

  const pendingCount = useMemo(() => {
    const list = (isHR || isAdmin) ? hrRichieste : myRichieste;
    return list.filter(r => r.stato === 'In attesa' || r.stato === 'Richiesta Annullamento' || r.stato === 'Richiesta Modifica').length;
  }, [hrRichieste, myRichieste, isHR, isAdmin]);

  const filteredRequestsList = useMemo(() => {
    let baseList = (isHR || isAdmin) ? hrRichieste : requestsList;

    // Per utenti standard, mostra le proprie richieste per la lista registro
    if (!isHR && !isAdmin) {
      baseList = baseList.filter(r => r.dipendenteName === myAssociatedName && r.note !== 'Chiusure Aziendali');
    } else {
      baseList = baseList.filter(r => r.note !== 'Chiusure Aziendali');
    }

    // Filtra per Tab
    if (requestTab === 'in_attesa') {
      baseList = baseList.filter(r => r.stato === 'In attesa' || r.stato === 'Richiesta Annullamento' || r.stato === 'Richiesta Modifica');
    } else if (requestTab === 'approvate') {
      baseList = baseList.filter(r => r.stato === 'Approvato');
    } else if (requestTab === 'storico') {
      baseList = baseList.filter(r => r.stato === 'Rifiutato');
    }

    // Escludi dalla vista registro le ferie la cui data ultima è antecedente a 60 giorni fa per mantenere la sezione pulita
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const sixtyDaysAgoStr = sixtyDaysAgo.toLocaleDateString('sv-SE');

    baseList = baseList.filter(r => {
      const lastDate = r.dataFine || r.dataInizio || r.data || '';
      return !lastDate || lastDate >= sixtyDaysAgoStr;
    });

    // Ordina in ordine cronologico dalla richiesta con la data più avanti nel tempo a quella più indietro
    return baseList.sort((a, b) => {
      const dateA = a.dataInizio || a.data || '';
      const dateB = b.dataInizio || b.data || '';
      if (dateA !== dateB) {
        return dateB.localeCompare(dateA);
      }
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeB - timeA;
    });
  }, [hrRichieste, requestsList, isHR, isAdmin, myAssociatedName, requestTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isPowerUser = isHR;
    
    if (!isPowerUser && !myAssociatedName) {
      showToast("Devi avere un profilo associato nell'anagrafica per richiedere ferie.", "warning");
      return;
    }

    const targetDipName = isPowerUser ? dipendenteSelezionato : myAssociatedName;
    if (!targetDipName) {
      showToast("Seleziona un dipendente.", "warning");
      return;
    }
    
    if (requestMode === 'singolo' && !dataRichiesta) {
      showToast("Seleziona una data.", "warning");
      return;
    }
    
    if (requestMode === 'range' && (!dataInizio || !dataFine)) {
      showToast("Seleziona sia la data di inizio che quella di fine.", "warning");
      return;
    }
    
    if (requestMode === 'range' && dataInizio > dataFine) {
      showToast("La data di inizio non può essere successiva alla data di fine.", "warning");
      return;
    }

    if ((tipoRichiesta === 'permesso' || tipoRichiesta === 'assenza') && frazioneTipo === 'orario') {
      if (!oraInizio || !oraFine) {
        showToast("Inserisci l'ora di inizio e di fine dell'assenza.", "warning");
        return;
      }
      if (oraInizio >= oraFine) {
        showToast("L'ora di inizio deve essere precedente all'ora di fine.", "warning");
        return;
      }
    }

    // Genera l'elenco delle date da controllare nel range richiesto
    const datesToCheck: string[] = [];
    if (requestMode === 'singolo') {
      datesToCheck.push(dataRichiesta);
    } else {
      const [sY, sM, sD] = dataInizio.split('-').map(Number);
      const [eY, eM, eD] = dataFine.split('-').map(Number);
      const curr = new Date(sY, sM - 1, sD);
      const last = new Date(eY, eM - 1, eD);
      while (curr <= last) {
        const y = curr.getFullYear();
        const m = String(curr.getMonth() + 1).padStart(2, '0');
        const d = String(curr.getDate()).padStart(2, '0');
        datesToCheck.push(`${y}-${m}-${d}`);
        curr.setDate(curr.getDate() + 1);
      }
    }

    const targetDipObj = dipendenti.find(d => d.nome === targetDipName);
    if (targetDipObj && targetDipObj.dataCessazione) {
      const invalidDate = datesToCheck.find(dStr => dStr > targetDipObj.dataCessazione!);
      if (invalidDate) {
        showToast(`Impossibile inserire la richiesta: la risorsa cessa il rapporto lavorativo il ${formatDate(targetDipObj.dataCessazione)}.`, "warning");
        return;
      }
    }

    setLoading(true);
    try {
      // 1. Recupera le richieste esistenti per questo dipendente con stato 'Approvato' o 'In attesa'
      const qAbsences = query(
        collection(db, 'richieste_ferie'),
        where('dipendenteName', '==', targetDipName)
      );
      const absencesSnap = await getDocs(qAbsences);
      const existingReqs = absencesSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter(r => r.stato === 'Approvato' || r.stato === 'In attesa');

      // 2. Controlla se ci sono conflitti per ciascun giorno richiesto
      for (const dStr of datesToCheck) {
        const coveringReqs = existingReqs.filter(r => {
          const start = r.dataInizio || r.data;
          const end = r.dataFine || r.data;
          return start && end && dStr >= start && dStr <= end;
        });

        for (const exist of coveringReqs) {
          let hasConflict = false;
          let conflictReason = '';

          const isExistFullDay = ['ferie', 'malattia', 'maternita', 'smart'].includes(exist.tipo) || ((exist.tipo === 'permesso' || exist.tipo === 'assenza') && (exist.frazioneTipo === 'giornata' || !exist.frazioneTipo));
          const isNewFullDay = ['ferie', 'malattia', 'maternita', 'smart'].includes(tipoRichiesta) || ((tipoRichiesta === 'permesso' || tipoRichiesta === 'assenza') && frazioneTipo === 'giornata');

          if (isExistFullDay || isNewFullDay) {
            hasConflict = true;
            conflictReason = `La risorsa risulta già assente/impegnata il ${formatDate(dStr)} (stato: "${exist.stato}").`;
          } else {
            // Entrambi sono frazioni di giornata (mattina, pomeriggio, o orari)
            const getSlot = (reqObj: any) => {
              if (reqObj.tipo === 'mattina' || reqObj.frazioneTipo === 'mattina') return { start: '09:00', end: '13:00' };
              if (reqObj.tipo === 'pomeriggio' || reqObj.frazioneTipo === 'pomeriggio') return { start: '14:00', end: '18:00' };
              return { start: reqObj.oraInizio || '09:00', end: reqObj.oraFine || '18:00' };
            };

            const slotExist = getSlot(exist);
            const slotNew = getSlot({ tipo: tipoRichiesta, frazioneTipo, oraInizio, oraFine });

            if (slotNew.start < slotExist.end && slotNew.end > slotExist.start) {
              hasConflict = true;
              conflictReason = `La risorsa ha già un permesso/assenza sovrapposto il ${formatDate(dStr)} (dalle ${slotExist.start} alle ${slotExist.end}, stato: "${exist.stato}").`;
            }
          }

          if (hasConflict) {
            showToast(conflictReason, "error");
            setLoading(false);
            return;
          }
        }
      }

      const payload: any = {
        dipendenteName: targetDipName,
        tipo: tipoRichiesta,
        stato: isPowerUser ? 'Approvato' : 'In attesa',
        timestamp: new Date().toISOString()
      };
      
      if (requestMode === 'singolo') {
        payload.data = dataRichiesta;
        payload.dataInizio = dataRichiesta;
        payload.dataFine = dataRichiesta;
      } else {
        payload.data = dataInizio; // legacy fallback
        payload.dataInizio = dataInizio;
        payload.dataFine = dataFine;
      }

      if (tipoRichiesta === 'permesso' || tipoRichiesta === 'assenza') {
        payload.frazioneTipo = frazioneTipo;
        if (frazioneTipo === 'orario') {
          payload.oraInizio = oraInizio;
          payload.oraFine = oraFine;
          if (pausaPranzo) {
            payload.pausaPranzo = true;
            payload.pausaPranzoOre = Number(pausaPranzoOre);
          }
        }
      }
      
      await addDoc(collection(db, 'richieste_ferie'), payload);
      
      setDataRichiesta('');
      setDataInizio('');
      setDataFine('');
      setOraInizio('09:00');
      setOraFine('18:00');
      setFrazioneTipo('giornata');
      setPausaPranzo(false);
      setPausaPranzoOre('1.0');
      showToast("Richiesta inviata con successo!");
      loadFerieData();
    } catch (err) {
      showToast("Errore nell'invio della richiesta.", "error");
    } finally {
      setLoading(false);
    }
  };

  const cleanAssignmentsForApprovedFullWeekLeave = async (dipName: string, startDateStr: string, endDateStr: string) => {
    try {
      if (!startDateStr || !endDateStr) return;
      const start = new Date(startDateStr);
      const end = new Date(endDateStr);
      const curr = new Date(start);
      
      const weekIds = new Set<string>();
      while (curr <= end) {
        const year = curr.getFullYear();
        const simple = new Date(year, 0, 4);
        const dayOfWeek = simple.getDay();
        const dayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const firstMonday = new Date(simple.setDate(simple.getDate() + dayOffset));
        const diffDays = Math.floor((curr.getTime() - firstMonday.getTime()) / (1000 * 60 * 60 * 24));
        const weekNum = Math.floor(diffDays / 7) + 1;
        weekIds.add(`${year}-W${weekNum}`);
        curr.setDate(curr.getDate() + 1);
      }

      for (const wkId of weekIds) {
        const docId = `${dipName}-${wkId}`;
        try {
          await deleteDoc(doc(db, 'assegnazioni', docId));
        } catch (err) {
          // Documento potrebbe non esistere
        }
      }
    } catch (e) {
      console.error("Errore pulizia retroattiva assegnazioni:", e);
    }
  };

  const handleDecision = async (id: string, approva: boolean) => {
    try {
      const req = richieste.find(r => r.id === id);
      if (!req) return;

      const newStatus = approva ? 'Approvato' : 'Rifiutato';
      await updateDoc(doc(db, 'richieste_ferie', id), {
        stato: newStatus
      });

      if (approva) {
        const startStr = req.dataInizio || req.data;
        const endStr = req.dataFine || req.data;
        if (startStr && endStr && (req.tipo === 'ferie' || req.tipo === 'malattia' || req.tipo === 'maternita')) {
          await cleanAssignmentsForApprovedFullWeekLeave(req.dipendenteName, startStr, endStr);
        }
      }

      // Invia notifica e-mail al dipendente
      const targetDip = dipendenti.find(d => d.nome === req.dipendenteName);
      if (targetDip && targetDip.email) {
        let dateDesc = req.dataInizio && req.dataFine && req.dataInizio !== req.dataFine 
          ? `dal ${formatDate(req.dataInizio)} al ${formatDate(req.dataFine)}` 
          : `il ${formatDate(req.dataInizio || req.data)}`;
        
        if (req.tipo === 'permesso' || req.tipo === 'assenza') {
          if (req.frazioneTipo === 'mattina') dateDesc += ' (mattina)';
          else if (req.frazioneTipo === 'pomeriggio') dateDesc += ' (pomeriggio)';
          else if (req.frazioneTipo === 'giornata') dateDesc += ' (giornata intera)';
          else if (req.oraInizio && req.oraFine) dateDesc += ` dalle ${req.oraInizio} alle ${req.oraFine}${req.pausaPranzo && req.pausaPranzoOre ? ` (esclusa pausa pranzo di ${req.pausaPranzoOre.toString().replace('.', ',')}h)` : ''}`;
        } else if (req.tipo === 'mattina') {
          dateDesc += ' (mattina)';
        } else if (req.tipo === 'pomeriggio') {
          dateDesc += ' (pomeriggio)';
        }
        
        const typeLabels: Record<string, string> = {
          ferie: 'Ferie',
          malattia: 'Malattia',
          maternita: 'Maternità',
          permesso: 'Permesso',
          assenza: 'Assenza',
          smart: 'Lavoro da Casa',
          mattina: 'Assenza Mattina',
          pomeriggio: 'Assenza Pomeriggio'
        };
        const typeDesc = typeLabels[req.tipo] || req.tipo;

        const subject = `[Notifica] Richiesta ${typeDesc} ${newStatus}`;
        const htmlBody = `
          <p>Ciao <strong>${req.dipendenteName}</strong>,</p>
          <p>La tua richiesta di <strong>${typeDesc}</strong> prevista <strong>${dateDesc}</strong> è stata <strong>${newStatus.toLowerCase()}</strong>.</p>
          <p>Puoi consultare lo stato delle tue richieste direttamente nella tua area personale della webapp.</p>
        `;
        const plainText = `Ciao ${req.dipendenteName},\n\nLa tua richiesta di ${typeDesc} prevista ${dateDesc} è stata ${newStatus.toLowerCase()}.\n\nPuoi consultare lo stato delle tue richieste direttamente nella tua area personale.\n\nQuesta è una notifica automatica.`;

        const isSelfTarget = (targetDip.email.toLowerCase() === userEmail?.toLowerCase()) || (myAssociatedName && req.dipendenteName === myAssociatedName);
        if (!isSelfTarget) {
          await queueMail(targetDip.email.toLowerCase(), subject, htmlBody, plainText);
        }
      }
      loadFerieData();
    } catch (e) {
      console.error("Errore aggiornamento:", e);
    }
  };

  const handleCancelApprovedLeave = async () => {
    if (!cancellationRequest) return;
    setCancellationLoading(true);
    try {
      const req = cancellationRequest;
      // 1. Elimina il documento da Firestore
      await deleteDoc(doc(db, 'richieste_ferie', req.id));

      // 2. Invia e-mail di notifica di annullamento al dipendente
      const targetDip = dipendenti.find(d => d.nome === req.dipendenteName);
      if (targetDip && targetDip.email) {
        let dateDesc = req.dataInizio && req.dataFine && req.dataInizio !== req.dataFine 
          ? `dal ${formatDate(req.dataInizio)} al ${formatDate(req.dataFine)}` 
          : `il ${formatDate(req.dataInizio || req.data)}`;
        
        if (req.tipo === 'permesso' || req.tipo === 'assenza') {
          if (req.frazioneTipo === 'mattina') dateDesc += ' (mattina)';
          else if (req.frazioneTipo === 'pomeriggio') dateDesc += ' (pomeriggio)';
          else if (req.frazioneTipo === 'giornata') dateDesc += ' (giornata intera)';
          else if (req.oraInizio && req.oraFine) dateDesc += ` dalle ${req.oraInizio} alle ${req.oraFine}${req.pausaPranzo && req.pausaPranzoOre ? ` (esclusa pausa pranzo di ${req.pausaPranzoOre.toString().replace('.', ',')}h)` : ''}`;
        } else if (req.tipo === 'mattina') {
          dateDesc += ' (mattina)';
        } else if (req.tipo === 'pomeriggio') {
          dateDesc += ' (pomeriggio)';
        }
        
        const typeLabels: Record<string, string> = {
          ferie: 'Ferie',
          malattia: 'Malattia',
          maternita: 'Maternità',
          permesso: 'Permesso',
          assenza: 'Assenza',
          smart: 'Lavoro da Casa',
          mattina: 'Assenza Mattina',
          pomeriggio: 'Assenza Pomeriggio'
        };
        const typeDesc = typeLabels[req.tipo] || req.tipo;

        const subject = `[Notifica] Annullamento richiesta ${typeDesc}`;
        const htmlBody = `
          <p>Ciao <strong>${req.dipendenteName}</strong>,</p>
          <p>Ti informiamo che la tua richiesta di <strong>${typeDesc}</strong> prevista <strong>${dateDesc}</strong> (in stato <em>${req.stato.toLowerCase()}</em>) è stata **annullata dall'amministrazione / HR**.</p>
          ${cancellationReason.trim() ? `<p><strong>Motivazione dell'annullamento:</strong> ${cancellationReason.trim()}</p>` : ''}
          <p>Il calendario e il registro presenze sono stati aggiornati di conseguenza.</p>
          <p>Questa è una notifica automatica inviata dal sistema Pianificazione Aziendale. Si prega di non rispondere a questo messaggio.</p>
        `;
        const plainText = `Ciao ${req.dipendenteName},\n\nTi informiamo che la tua richiesta di ${typeDesc} prevista ${dateDesc} (in stato ${req.stato.toLowerCase()}) è stata annullata dall'amministrazione / HR.\n\n${cancellationReason.trim() ? `Motivazione dell'annullamento: ${cancellationReason.trim()}\n\n` : ''}Questa è una notifica automatica.`;

        const isSelfTarget = (targetDip.email.toLowerCase() === userEmail?.toLowerCase()) || (myAssociatedName && req.dipendenteName === myAssociatedName);
        if (!isSelfTarget) {
          await queueMail(targetDip.email.toLowerCase(), subject, htmlBody, plainText);
        }
      }

      showToast("Ferie annullate con successo!");
      setCancellationRequest(null);
      setCancellationReason('');
      loadFerieData();
    } catch (err) {
      console.error(err);
      showToast("Errore durante l'annullamento delle ferie.", "error");
    } finally {
      setCancellationLoading(false);
    }
  };

  // Funzioni di gestione per richieste di modifica / annullamento da parte del dipendente
  const openModificationModal = (req: RichiestaFerie) => {
    setModifyingRequest(req);
    setModTipoAzione('annullamento');
    setModDataInizio(req.dataInizio || req.data || '');
    setModDataFine(req.dataFine || req.data || '');
    setModOraInizio(req.oraInizio || '09:00');
    setModOraFine(req.oraFine || '18:00');
    setModFrazioneTipo(req.frazioneTipo || 'giornata');
    setModTipo(req.tipo || 'ferie');
    setModMotivazione('');
  };

  const handleSendModificationRequest = async () => {
    if (!modifyingRequest) return;
    if (modTipoAzione === 'modifica' && (!modDataInizio || !modDataFine)) {
      showToast("Seleziona le nuove date per la modifica.", "warning");
      return;
    }
    setModLoading(true);
    try {
      const newStato = modTipoAzione === 'annullamento' ? 'Richiesta Annullamento' : 'Richiesta Modifica';
      const payloadModifica: any = {
        tipoAzione: modTipoAzione,
        motivazione: modMotivazione.trim(),
        dataRichiesta: new Date().toISOString()
      };
      if (modTipoAzione === 'modifica') {
        payloadModifica.nuovaDataInizio = modDataInizio;
        payloadModifica.nuovaDataFine = modDataFine;
        payloadModifica.nuovoTipo = modTipo;
        payloadModifica.nuovaFrazioneTipo = modFrazioneTipo;
        if (modFrazioneTipo === 'orario') {
          payloadModifica.nuovaOraInizio = modOraInizio;
          payloadModifica.nuovaOraFine = modOraFine;
        }
      }

      await updateDoc(doc(db, 'richieste_ferie', modifyingRequest.id), {
        stato: newStato,
        richiestaModifica: payloadModifica
      });

      // Invia notifica email all'HR (Chiara)
      const hrEmails = ['chiara@ingegno06.it', 'aprofeti@ingegno06.it', 'mcorbellini@ingegno06.it'];
      const subject = `[Notifica HR] ${newStato} da parte di ${modifyingRequest.dipendenteName}`;
      const dateDesc = modifyingRequest.dataInizio && modifyingRequest.dataFine && modifyingRequest.dataInizio !== modifyingRequest.dataFine
        ? `dal ${formatDate(modifyingRequest.dataInizio)} al ${formatDate(modifyingRequest.dataFine)}`
        : `il ${formatDate(modifyingRequest.dataInizio || modifyingRequest.data)}`;

      let modDetail = '';
      if (modTipoAzione === 'annullamento') {
        modDetail = `<p>Il dipendente richiede l'<strong>annullamento completo</strong> delle ferie/permessi approvati per il periodo <strong>${dateDesc}</strong>.</p>`;
      } else {
        const newDateDesc = modDataInizio === modDataFine ? `il ${formatDate(modDataInizio)}` : `dal ${formatDate(modDataInizio)} al ${formatDate(modDataFine)}`;
        modDetail = `<p>Il dipendente richiede di <strong>modificare</strong> le ferie/permessi approvati dal periodo <strong>${dateDesc}</strong> al nuovo periodo <strong>${newDateDesc}</strong>.</p>`;
      }

      const htmlBody = `
        <p>Ciao Chiara / HR Team,</p>
        <p>È stata inviata una <strong>${newStato}</strong> per le ferie/permessi già approvati di <strong>${modifyingRequest.dipendenteName}</strong>.</p>
        ${modDetail}
        ${modMotivazione.trim() ? `<p><strong>Motivazione del dipendente:</strong> ${modMotivazione.trim()}</p>` : ''}
        <p>Accedi all'area <em>Permessi e Ferie</em> per approvare o gestire la richiesta.</p>
      `;
      const plainText = `Ciao HR Team,\n\nRichiesta ${newStato} da parte di ${modifyingRequest.dipendenteName}.\nMotivazione: ${modMotivazione.trim()}\n\nAccedi alla piattaforma per gestire la richiesta.`;

      for (const email of hrEmails) {
        await queueMail(email, subject, htmlBody, plainText);
      }

      showToast("Richiesta di modifica/annullamento inviata all'HR con successo!", "success");
      setModifyingRequest(null);
      loadFerieData();
    } catch (err) {
      console.error("Errore invio richiesta modifica:", err);
      showToast("Errore durante l'invio della richiesta.", "error");
    } finally {
      setModLoading(false);
    }
  };

  const handleHRApproveModification = async (req: RichiestaFerie) => {
    if (!req.richiestaModifica) return;
    try {
      const mod = req.richiestaModifica;
      const newStart = mod.nuovaDataInizio || req.dataInizio || req.data;
      const newEnd = mod.nuovaDataFine || req.dataFine || req.data;
      const newTipo = mod.nuovoTipo || req.tipo;
      const newFrazione = mod.nuovaFrazioneTipo || req.frazioneTipo;
      const newOraInizio = mod.nuovaOraInizio || req.oraInizio;
      const newOraFine = mod.nuovaOraFine || req.oraFine;

      await updateDoc(doc(db, 'richieste_ferie', req.id), {
        stato: 'Approvato',
        dataInizio: newStart,
        dataFine: newEnd,
        data: newStart,
        tipo: newTipo,
        frazioneTipo: newFrazione,
        oraInizio: newOraInizio || null,
        oraFine: newOraFine || null,
        richiestaModifica: null
      });

      if (newStart && newEnd && (newTipo === 'ferie' || newTipo === 'malattia' || newTipo === 'maternita')) {
        await cleanAssignmentsForApprovedFullWeekLeave(req.dipendenteName, newStart, newEnd);
      }

      const targetDip = dipendenti.find(d => d.nome === req.dipendenteName);
      if (targetDip && targetDip.email) {
        const subject = `[Notifica] Modifica Ferie/Permesso Approvata`;
        const htmlBody = `
          <p>Ciao <strong>${req.dipendenteName}</strong>,</p>
          <p>La tua richiesta di <strong>modifica</strong> delle ferie/permessi è stata <strong>approvata dall'HR</strong>.</p>
          <p>Nuovo periodo approvato: dal <strong>${formatDate(newStart)}</strong> al <strong>${formatDate(newEnd)}</strong>.</p>
        `;
        const plainText = `Ciao ${req.dipendenteName},\n\nLa tua richiesta di modifica è stata approvata dall'HR.\nNuovo periodo: dal ${formatDate(newStart)} al ${formatDate(newEnd)}.`;
        await queueMail(targetDip.email.toLowerCase(), subject, htmlBody, plainText);
      }

      showToast("Modifica approvata ed applicata con successo!", "success");
      loadFerieData();
    } catch (err) {
      console.error(err);
      showToast("Errore durante l'applicazione della modifica.", "error");
    }
  };

  const handleHRApproveCancellation = async (req: RichiestaFerie) => {
    try {
      await deleteDoc(doc(db, 'richieste_ferie', req.id));

      const targetDip = dipendenti.find(d => d.nome === req.dipendenteName);
      if (targetDip && targetDip.email) {
        const subject = `[Notifica] Annullamento Ferie/Permesso Confermato`;
        const htmlBody = `
          <p>Ciao <strong>${req.dipendenteName}</strong>,</p>
          <p>La tua richiesta di <strong>annullamento</strong> per le ferie/permessi del <strong>${formatDate(req.dataInizio || req.data)}</strong> è stata <strong>confermata dall'HR</strong>.</p>
          <p>Il giorno/periodo è stato ripristinato nel tuo calendario.</p>
        `;
        const plainText = `Ciao ${req.dipendenteName},\n\nLa tua richiesta di annullamento per il ${formatDate(req.dataInizio || req.data)} è stata confermata dall'HR.`;
        await queueMail(targetDip.email.toLowerCase(), subject, htmlBody, plainText);
      }

      showToast("Annullamento approvato con successo!", "success");
      loadFerieData();
    } catch (err) {
      console.error(err);
      showToast("Errore durante l'annullamento.", "error");
    }
  };

  const handleHRRejectModificationOrCancellation = async (req: RichiestaFerie) => {
    try {
      await updateDoc(doc(db, 'richieste_ferie', req.id), {
        stato: 'Approvato',
        richiestaModifica: null
      });

      const targetDip = dipendenti.find(d => d.nome === req.dipendenteName);
      if (targetDip && targetDip.email) {
        const subject = `[Notifica] Richiesta Modifica/Annullamento non accolta`;
        const htmlBody = `
          <p>Ciao <strong>${req.dipendenteName}</strong>,</p>
          <p>La tua richiesta di modifica/annullamento per le ferie/permessi del <strong>${formatDate(req.dataInizio || req.data)}</strong> non è stata accolta. La richiesta originale rimane confermata ed approvata.</p>
        `;
        const plainText = `Ciao ${req.dipendenteName},\n\nLa tua richiesta di modifica/annullamento per il ${formatDate(req.dataInizio || req.data)} non è stata accolta.`;
        await queueMail(targetDip.email.toLowerCase(), subject, htmlBody, plainText);
      }

      showToast("Richiesta ripristinata allo stato approvato originale.", "info");
      loadFerieData();
    } catch (err) {
      console.error(err);
      showToast("Errore durante l'operazione.", "error");
    }
  };

  const handleWithdrawPendingRequest = async (reqId: string) => {
    try {
      await deleteDoc(doc(db, 'richieste_ferie', reqId));
      showToast("Richiesta in attesa ritirata con successo.", "success");
      loadFerieData();
    } catch (err) {
      showToast("Errore durante l'annullamento.", "error");
    }
  };

  const getStatusBadge = (stato: string) => {
    switch(stato) {
      case 'Approvato': 
        return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-green-100 text-green-700 px-2.5 py-1 rounded-full"><CheckCircle className="w-3.5 h-3.5"/> Approvato</span>;
      case 'Rifiutato': 
        return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-red-100 text-red-700 px-2.5 py-1 rounded-full"><XCircle className="w-3.5 h-3.5"/> Rifiutato</span>;
      case 'Richiesta Annullamento': 
        return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full border border-amber-300"><AlertTriangle className="w-3.5 h-3.5 text-amber-600"/> Richiesta Annullamento</span>;
      case 'Richiesta Modifica': 
        return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-orange-100 text-orange-800 px-2.5 py-1 rounded-full border border-orange-300"><Pencil className="w-3.5 h-3.5 text-orange-600"/> Richiesta Modifica</span>;
      default: 
        return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full"><Clock className="w-3.5 h-3.5"/> In attesa</span>;
    }
  };

  const getTipoData = (tipo: string, frazioneTipo?: string, dipName?: string) => {
    const isCollab = dipName ? (dipendenti || []).some(d => d.nome && d.nome.toLowerCase().trim() === dipName.toLowerCase().trim() && d.tipo === 'collaboratore') : false;
    const tipi: Record<string, {label: string, color: string}> = {
      ferie: {label: isCollab ? 'Assenza' : 'Ferie', color: 'bg-red-500'},
      malattia: {label: 'Malattia', color: 'bg-purple-600'},
      maternita: {label: 'Maternità', color: 'bg-pink-500'},
      permesso: {label: isCollab ? 'Assenza' : 'Permesso', color: 'bg-amber-500'},
      assenza: {label: 'Assenza', color: 'bg-amber-500'},
      smart: {label: 'Lavora da Casa', color: 'bg-blue-500'},
      mattina: {label: 'Assenza Mattina', color: 'bg-amber-500'},
      pomeriggio: {label: 'Assenza Pomeriggio', color: 'bg-amber-500'},
      studio: {label: 'Permesso Studio', color: 'bg-violet-600'},
      donazione: {label: 'Permesso Donazione', color: 'bg-teal-500'},
      elettorale: {label: 'Permesso Elettorale', color: 'bg-indigo-500'}
    };
    const base = tipi[tipo] || {label: isCollab ? 'Assenza' : tipo, color: 'bg-gray-500'};
    if ((tipo === 'permesso' || tipo === 'assenza') && frazioneTipo) {
      const copy = { ...base };
      const prefix = (isCollab || tipo === 'assenza') ? 'Assenza' : 'Permesso';
      if (frazioneTipo === 'mattina') copy.label = `${prefix} Mattina`;
      if (frazioneTipo === 'pomeriggio') copy.label = `${prefix} Pomeriggio`;
      if (frazioneTipo === 'giornata') copy.label = `${prefix} Giornata Intera`;
      if (frazioneTipo === 'orario') copy.label = `${prefix} Orario`;
      return copy;
    }
    return base;
  };

  const getTipoLabel = (tipo: string, frazioneTipo?: string, dipName?: string) => {
    const t = getTipoData(tipo, frazioneTipo, dipName);
    return (
      <span className="text-xs sm:text-sm font-bold text-gray-600 bg-gray-100 px-2 py-1 rounded-lg capitalize">
        {t.label}
      </span>
    );
  };

  const handlePrintFeriePlan = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth(); // 0-indexed
    const monthLabel = currentMonth.toLocaleString('it-IT', { month: 'long' }).toUpperCase();
    const numDays = new Date(year, month + 1, 0).getDate();

    const firstDayOfMonthStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const sortedDipendenti = dipendenti
      .filter(d => !d.dataCessazione || d.dataCessazione >= firstDayOfMonthStr)
      .sort((a, b) => a.nome.trim().localeCompare(b.nome.trim()));

    const statusMap: Record<string, Record<number, RichiestaFerie>> = {};
    sortedDipendenti.forEach(dip => {
      statusMap[dip.nome] = {};
    });

    richieste.forEach(req => {
      // Include anche 'Richiesta Modifica' e 'Richiesta Annullamento': il periodo originale
      // approvato è ancora valido finché l'HR non ha accettato la modifica/annullamento.
      const isVisibleInPrint = req.stato === 'Approvato' || req.stato === 'Richiesta Modifica' || req.stato === 'Richiesta Annullamento';
      if (!isVisibleInPrint) return;
      const start = req.dataInizio || req.data;
      const end = req.dataFine || req.data;
      if (!start || !end) return;

      const [sY, sM, sD] = start.split('-').map(Number);
      const [eY, eM, eD] = end.split('-').map(Number);
      const curr = new Date(sY, sM - 1, sD);
      const last = new Date(eY, eM - 1, eD);

      while (curr <= last) {
        const y = curr.getFullYear();
        const m = curr.getMonth();
        const d = curr.getDate();

        if (y === year && m === month) {
          const dipName = req.dipendenteName;
          if (statusMap[dipName]) {
            statusMap[dipName][d] = req;
          }
        }
        curr.setDate(curr.getDate() + 1);
      }
    });

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast("Consenti i pop-up per stampare il piano ferie.", "warning");
      return;
    }

    const rowsHtml = sortedDipendenti.map(dip => {
      const daysCells = Array.from({ length: 31 }).map((_, i) => {
        const day = i + 1;
        if (day > numDays) {
          return `<td class="empty-cell"></td>`;
        }

        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dateObj = new Date(year, month, day);
        const dayOfWeek = dateObj.getDay();
        const isWknd = dayOfWeek === 0 || dayOfWeek === 6;
        const isHoliday = isItalianHoliday(dateStr);
        const isUnlocked = approvedWeekends[`${dip.nome}_${dateStr}`];
        const isSpecialDay = (isWknd || isHoliday) && !isUnlocked;
        const isCessato = dip.dataCessazione && dateStr > dip.dataCessazione;

        const reqObj = statusMap[dip.nome]?.[day];
        const tipo = reqObj?.tipo;
        let cellBg = '';
        let cellText = '';
        let textColor = '#000000';

        if (isCessato) {
          cellBg = '#4b5563';
          cellText = 'X';
          textColor = '#ffffff';
        } else if (isSpecialDay) {
          cellBg = '#f3f4f6';
        } else if (tipo) {
          const isCollabDip = dip.tipo === 'collaboratore';
          const isFractional = Boolean(reqObj.frazioneTipo || (reqObj.oraInizio && reqObj.oraFine) || tipo === 'mattina' || tipo === 'pomeriggio');

          if (tipo === 'ferie' || (isCollabDip && (tipo === 'assenza' || tipo === 'ferie') && !isFractional)) {
            cellBg = '#38bdf8'; // Sky Blue (Ferie Dipendenti / Assenza Giornata Intera Collaboratori)
            textColor = '#ffffff';
          } else if (['malattia', 'maternita'].includes(tipo)) {
            cellBg = '#ef4444'; // Rosso (Malattia / Maternità)
            cellText = 'M';
            textColor = '#ffffff';
          } else if (tipo === 'smart') {
            cellBg = '#84cc16'; // Verde Lime (Lavora da Casa)
            textColor = '#ffffff';
          } else if (['mattina', 'pomeriggio', 'permesso', 'assenza'].includes(tipo) || (isCollabDip && isFractional)) {
            cellBg = '#facc15'; // Giallo (Permesso Dipendenti / Assenza Oraria Collaboratori)
            textColor = '#713f12';
            
            if (reqObj.frazioneTipo === 'mattina' || tipo === 'mattina') {
              cellText = 'AM';
            } else if (reqObj.frazioneTipo === 'pomeriggio' || tipo === 'pomeriggio') {
              cellText = 'PM';
            } else if (reqObj.frazioneTipo === 'giornata') {
              cellText = 'GI';
            } else if (reqObj.oraInizio && reqObj.oraFine) {
              const [hStart, mStart] = reqObj.oraInizio.split(':').map(Number);
              const [hEnd, mEnd] = reqObj.oraFine.split(':').map(Number);
              const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
              let hrs = Math.round((diffMs / 3600000) * 100) / 100;
              if (reqObj.pausaPranzo && reqObj.pausaPranzoOre) {
                hrs = Math.max(0, hrs - reqObj.pausaPranzoOre);
              }
              cellText = `${hrs.toString().replace('.', ',')}h`;
            } else {
              cellText = isCollabDip ? 'A' : 'P';
            }
          } else if (tipo === 'studio') {
            cellBg = '#c084fc'; // Purple
            cellText = 'S';
            textColor = '#581c87';
          } else if (tipo === 'donazione') {
            cellBg = '#2dd4bf'; // Teal
            cellText = 'D';
            textColor = '#115e59';
          } else if (tipo === 'elettorale') {
            cellBg = '#818cf8'; // Indigo
            cellText = 'E';
            textColor = '#312e81';
          }
        }

        const styleAttr = cellBg ? ` style="background-color: ${cellBg} !important; color: ${textColor} !important;"` : '';
        return `<td${styleAttr}>${cellText}</td>`;
      }).join('');

      return `
        <tr>
          <td class="name-cell">${dip.nome}</td>
          ${daysCells}
        </tr>
      `;
    }).join('');

    const headerDaysHtml = Array.from({ length: 31 }).map((_, i) => {
      const day = i + 1;
      if (day > numDays) {
        return `<th class="empty-cell">${day}</th>`;
      }

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dateObj = new Date(year, month, day);
      const dayOfWeek = dateObj.getDay();
      const isWknd = dayOfWeek === 0 || dayOfWeek === 6;
      const isHoliday = isItalianHoliday(dateStr);
      const isSpecialDay = isWknd || isHoliday;

      const style = isSpecialDay ? ' style="background-color: #e5e7eb !important; color: #6b7280 !important;"' : '';
      return `<th${style}>${day}</th>`;
    }).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Stampa Piano Ferie - ${monthLabel} ${year}</title>
          <style>
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              box-sizing: border-box;
            }
            @page {
              size: A4 portrait;
              margin: 0.5cm;
            }
            html, body {
              margin: 0;
              padding: 0;
              font-family: 'Inter', -apple-system, Arial, sans-serif;
              color: #111827;
              background-color: #ffffff;
              font-size: 6.5px;
            }
            .header-container {
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
              border-bottom: 2px solid #111827;
              padding-bottom: 6px;
              margin-bottom: 8px;
            }
            .title-main {
              font-weight: 900;
              font-size: 18px;
              letter-spacing: -0.02em;
              color: #111827;
              text-transform: uppercase;
            }
            .title-sub {
              font-weight: 700;
              font-size: 9px;
              color: #6b7280;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              margin-top: 1px;
            }
            .logo-img {
              height: 32px;
              object-fit: contain;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
              border: 0.5px solid #d1d5db;
            }
            th, td {
              border: 0.5px solid #d1d5db;
              padding: 2px 0;
              text-align: center;
              font-size: 6px;
              font-weight: bold;
              height: 14px;
            }
            th {
              background-color: #f3f4f6 !important;
              color: #374151;
              font-weight: 800;
              border-bottom: 1px solid #9ca3af;
            }
            .name-cell {
              text-align: left;
              padding-left: 4px;
              font-weight: 800;
              font-size: 6.5px;
              color: #111827;
              border-right: 1px solid #d1d5db;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              background-color: #ffffff !important;
            }
            .empty-cell {
              background-color: #f9fafb !important;
            }
            .legend-box {
              margin-top: 8px;
              border-top: 1px solid #e5e7eb;
              padding-top: 5px;
            }
            .legend-title {
              font-weight: 850;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              margin-bottom: 4px;
              font-size: 6.5px;
              color: #374151;
            }
            .legend-items {
              display: flex;
              flex-wrap: wrap;
              gap: 3px 8px;
            }
            .legend-item {
              display: flex;
              align-items: center;
              gap: 3px;
              font-size: 5.8px;
              font-weight: 700;
              color: #4b5563;
              background-color: #f9fafb !important;
              border: 0.5px solid #e5e7eb;
              padding: 2px 4px;
              border-radius: 3px;
            }
            .color-block {
              width: 12px;
              height: 9px;
              border-radius: 2px;
              border: 0.5px solid #d1d5db;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              font-size: 5.5px;
              font-weight: 900;
            }
          </style>
        </head>
        <body>
          <div class="header-container">
            <div>
              <div class="title-main">${monthLabel} ${year}</div>
              <div class="title-sub">Pianificazione Ferie & Assenze — Documento Aziendale</div>
            </div>
            <div>
              <img src="${window.location.origin}/Logo.png" alt="Logo Ingegno" class="logo-img" />
            </div>
          </div>

          <div class="table-container">
            <table>
              <colgroup>
                <col style="width: 18%;" />
                ${Array.from({ length: 31 }).map(() => `<col style="width: 2.64%;" />`).join('')}
              </colgroup>
              <thead>
                <tr>
                  <th>ELENCO PERSONALE</th>
                  ${headerDaysHtml}
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>

          <div class="legend-box">
            <div class="legend-title">Legenda:</div>
            <div class="legend-items">
              <div class="legend-item">
                <div class="color-block" style="background-color: #38bdf8 !important;"></div>
                <span>FERIE (DIPENDENTI) / ASSENZA (COLLABORATORI P.IVA)</span>
              </div>
              <div class="legend-item">
                <div class="color-block" style="background-color: #facc15 !important;"></div>
                <span>PERMESSO (DIPENDENTI) / ASSENZA ORARIA (COLLABORATORI)</span>
              </div>
              <div class="legend-item">
                <div class="color-block" style="background-color: #ef4444 !important; color: #ffffff !important;">M</div>
                <span>MALATTIA / MATERNITÀ</span>
              </div>
              <div class="legend-item">
                <div class="color-block" style="background-color: #84cc16 !important;"></div>
                <span>LAVORA DA CASA</span>
              </div>
              <div class="legend-item">
                <div class="color-block" style="background-color: #c084fc !important; color: #581c87 !important;">S</div>
                <span>PERMESSO STUDIO</span>
              </div>
              <div class="legend-item">
                <div class="color-block" style="background-color: #2dd4bf !important; color: #115e59 !important;">D</div>
                <span>PERMESSO DONAZIONE</span>
              </div>
              <div class="legend-item">
                <div class="color-block" style="background-color: #818cf8 !important; color: #312e81 !important;">E</div>
                <span>PERMESSO ELETTORALE</span>
              </div>
              <div class="legend-item">
                <div class="color-block" style="background-color: #4b5563 !important; color: #ffffff !important;">X</div>
                <span>CESSATO / INATTIVO</span>
              </div>
            </div>
          </div>
          ${getPrintFooterHtml()}
          <script>
            function closeWindow() {
              try { window.close(); } catch(e) {}
            }
            window.onafterprint = closeWindow;
            window.onload = function() {
              setTimeout(function() {
                window.print();
                closeWindow();
                setTimeout(closeWindow, 500);
              }, 250);
            };
            window.onfocus = function() {
              setTimeout(closeWindow, 300);
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  // --- LOGICA CALENDARIO ---
  const shiftMonth = (delta: number) => {
    const d = new Date(currentMonth);
    d.setMonth(d.getMonth() + delta);
    setCurrentMonth(d);
  };

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayIndex = (new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay() + 6) % 7; // Lunedi = 0
  
  const monthName = currentMonth.toLocaleString('it-IT', { month: 'long', year: 'numeric' });
  const calendarCells = [];
  
  // Celle vuote iniziali
  for (let i = 0; i < firstDayIndex; i++) {
    calendarCells.push(<div key={`empty-${i}`} className="min-h-[100px] bg-gray-50/50 rounded-xl border border-transparent"></div>);
  }
  
  // Giorni effettivi
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayRequests = richieste.filter(r => {
      if (r.stato === 'Rifiutato') return false;
      const start = r.dataInizio || r.data;
      const end = r.dataFine || r.data;
      return start && end && dateStr >= start && dateStr <= end;
    });

    // Dividiamo le chiusure aziendali dalle altre richieste
    const closureReqs = dayRequests.filter(r => r.note === 'Chiusure Aziendali' && r.stato === 'Approvato');
    const otherReqs = dayRequests.filter(r => r.note !== 'Chiusure Aziendali' || r.stato !== 'Approvato');

    // Ordiniamo le altre richieste in ordine alfabetico per dipendente
    const sortedOthers = [...otherReqs].sort((a, b) => a.dipendenteName.localeCompare(b.dipendenteName));

    const isWknd = isWeekend(dateStr);
    const isHoliday = isItalianHoliday(dateStr);
    const isChiusura = isInChiusuraAziendaleLocal(dateStr) || closureReqs.length > 0;
    const isSpecialDay = isWknd || isHoliday;

    let cellStyle: React.CSSProperties = {};
    let cellClass = "min-h-[100px] rounded-xl border border-gray-200 p-2 shadow-sm hover:shadow-md transition-all flex flex-col";
    
    if (isSpecialDay) {
      cellStyle = { background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)' };
      cellClass += " bg-gray-100/50 text-gray-500";
    } else {
      cellClass += " bg-white";
    }

    const isToday = dateStr === new Date().toLocaleDateString('sv-SE');
    if (isToday) {
      cellClass += " ring-2 ring-green-600 z-10";
    }

    // Se è un giorno festivo o weekend, non mostriamo le richieste individuali di assenza
    const displayOthers = isSpecialDay ? [] : sortedOthers;
    // Se c'è chiusura aziendale, mostriamo il badge Chiusura solo se non è weekend/festivo
    const showClosureBadge = isChiusura && !isSpecialDay;

    calendarCells.push(
      <div key={day} style={cellStyle} className={cellClass}>
        <div className={`font-bold mb-1 text-right ${isSpecialDay ? 'text-gray-400' : 'text-gray-700'}`}>{day}</div>
        <div className="flex-1 flex flex-col gap-1 overflow-y-auto custom-scrollbar pr-1">
          {/* Badge riepilogativo per le chiusure aziendali */}
          {showClosureBadge && (
            <div 
              className="bg-indigo-100 border border-indigo-200 text-indigo-900 text-[10px] p-1.5 rounded-lg font-extrabold text-center flex items-center justify-center gap-1.5 shadow-sm cursor-help select-none mb-0.5 shrink-0"
              title={closureReqs.length > 0 ? `Dipendenti in ferie per chiusura:\n${[...closureReqs].map(r => r.dipendenteName).sort((a, b) => a.localeCompare(b)).join('\n')}` : `Azienda chiusa per ferie collettive`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"></span>
              <span className="truncate">🏢 Chiusura {closureReqs.length > 0 ? `(${closureReqs.length} dip.)` : ''}</span>
            </div>
          )}

          {/* Mappa delle altre richieste ordinate alfabeticamente */}
          {displayOthers.map(req => {
            const t = getTipoData(req.tipo, req.frazioneTipo, req.dipendenteName);
            let bg = 'bg-gray-100 border-gray-200 text-gray-800';
            let dotBg = 'bg-gray-400';
            if(req.stato === 'Approvato') {
              bg = 'bg-green-50 border-green-200 text-green-800';
              dotBg = 'bg-green-400';
            }
            if(req.stato === 'Rifiutato') {
              bg = 'bg-red-50 border-red-200 text-red-800 opacity-50 line-through';
              dotBg = 'bg-red-400';
            }
            if(req.stato === 'In attesa') {
              bg = 'bg-yellow-50 border-yellow-200 text-yellow-800';
              dotBg = 'bg-yellow-300';
            }

            let hourSuffix = '';
            if (req.tipo === 'permesso' || req.tipo === 'assenza') {
              if (req.frazioneTipo === 'mattina') hourSuffix = ' AM';
              else if (req.frazioneTipo === 'pomeriggio') hourSuffix = ' PM';
              else if (req.frazioneTipo === 'giornata') hourSuffix = ' GI';
              else if (req.oraInizio && req.oraFine) {
                hourSuffix = ` (${req.oraInizio}-${req.oraFine}${req.pausaPranzo && req.pausaPranzoOre ? `, escl. p.pranzo ${req.pausaPranzoOre.toString().replace('.', ',')}h` : ''})`;
              }
            }

            const isPowerUser = isHR || isAdmin;
            return (
              <div 
                key={req.id} 
                onClick={() => {
                  if (isPowerUser) {
                    setCancellationRequest(req);
                    setCancellationReason('');
                  }
                }}
                className={`text-[10px] p-1.5 rounded border ${bg} flex items-center gap-1.5 font-medium leading-tight shadow-sm ${
                  isPowerUser ? 'cursor-pointer hover:brightness-95 active:scale-95 transition-all' : ''
                }`}
                title={isPowerUser ? "Clicca per annullare/eliminare questa richiesta" : undefined}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotBg}`}></span>
                <span className="truncate" title={`${req.dipendenteName} - ${t.label}${hourSuffix}`}>
                  {req.dipendenteName} ({t.label}){hourSuffix}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 no-print">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
            <div className="p-3 bg-green-100 rounded-2xl"><Calendar className="w-8 h-8 text-green-600" /></div>
            <div className="flex items-center gap-3">
              <span>Piano Ferie e Assenze</span>
              <button 
                onClick={loadFerieData}
                title="Aggiorna Dati"
                className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 border border-transparent hover:border-green-100 rounded-xl transition-all cursor-pointer hover:rotate-180 duration-500"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </h2>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
          
          {/* FORM NUOVA RICHIESTA */}
          <div className="bg-white/70 backdrop-blur-xl p-6 sm:p-8 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between h-full">
            <div>
              <div className="pb-3 border-b border-gray-150 mb-6">
                <h3 className="font-extrabold text-xl text-gray-900 flex items-center gap-2">
                  Nuova Richiesta Personale
                </h3>
                <p className="text-xs text-gray-500 font-medium mt-0.5">
                  Compila il modulo per inoltrare la tua richiesta all'HR
                </p>
              </div>
              
              <div className="bg-emerald-600/10 border border-emerald-500/20 rounded-2xl p-4 mb-5 text-xs text-emerald-950 leading-relaxed font-semibold flex gap-2.5 items-start">
                <span className="w-5 h-5 shrink-0 bg-emerald-600 text-white rounded-full flex items-center justify-center font-extrabold text-[10px]">i</span>
                <div>
                  <strong>Nota Importante:</strong> Assicurati di esserti accordato a voce con il tuo responsabile prima di inoltrare la richiesta.
                </div>
              </div>

              {!myAssociatedName && !(isAdmin || isHR) ? (
                <div className="bg-yellow-100 text-yellow-800 p-4 rounded-xl text-sm font-medium">
                  Il tuo profilo non è associato ad un nome nell'anagrafica. Contatta un amministratore per poter richiedere le ferie.
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  {isHR && (
                    <div>
                      <label className="block text-sm font-bold text-green-900 mb-1.5 ml-1">Dipendente</label>
                      <select
                        value={dipendenteSelezionato}
                        onChange={e => setDipendenteSelezionato(e.target.value)}
                        required
                        className="w-full p-3.5 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-medium text-green-900"
                      >
                        <option value="">-- Seleziona Dipendente --</option>
                        {dipendenti.filter(d => !d.dataCessazione || d.dataCessazione >= new Date().toLocaleDateString('sv-SE')).map(d => (
                          <option key={d.id} value={d.nome}>{d.nome}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  
                  <div className="flex bg-white/50 p-1 rounded-xl shadow-inner border border-green-100/50">
                    <button
                      type="button"
                      onClick={() => setRequestMode('singolo')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${requestMode === 'singolo' ? 'bg-green-600 text-white shadow-sm' : 'text-green-800/70 hover:text-green-900'}`}
                    >
                      Giorno Singolo
                    </button>
                    <button
                      type="button"
                      onClick={() => setRequestMode('range')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${requestMode === 'range' ? 'bg-green-600 text-white shadow-sm' : 'text-green-800/70 hover:text-green-900'}`}
                    >
                      Intervallo di Date
                    </button>
                  </div>

                  {requestMode === 'singolo' ? (
                    <div>
                      <label className="block text-sm font-bold text-green-900 mb-1.5 ml-1">Giorno di assenza</label>
                      <input 
                        type="date" 
                        required 
                        value={dataRichiesta}
                        onChange={e => setDataRichiesta(e.target.value)}
                        className="w-full p-3.5 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-medium text-green-900"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-green-900 mb-1.5 ml-1">Data Inizio</label>
                        <input 
                          type="date" 
                          required 
                          value={dataInizio}
                          onChange={e => setDataInizio(e.target.value)}
                          className="w-full p-3.5 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-medium text-green-900 text-xs sm:text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-green-900 mb-1.5 ml-1">Data Fine</label>
                        <input 
                          type="date" 
                          required 
                          value={dataFine}
                          onChange={e => setDataFine(e.target.value)}
                          className="w-full p-3.5 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-medium text-green-900 text-xs sm:text-sm"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-bold text-green-900 mb-1.5 ml-1">Tipo di assenza</label>
                    <select 
                      value={tipoRichiesta} 
                      onChange={e => setTipoRichiesta(e.target.value)}
                      className="w-full p-3.5 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-medium text-green-900"
                    >
                      {isCollaboratore ? (
                        <>
                          <option value="assenza">Assenza</option>
                          <option value="malattia">Malattia</option>
                          <option value="maternita">Maternità</option>
                          <option value="smart">Lavora da Casa</option>
                        </>
                      ) : (
                        <>
                          <option value="ferie">Ferie</option>
                          <option value="permesso">Permesso</option>
                          <option value="malattia">Malattia</option>
                          <option value="maternita">Maternità</option>
                          <option value="smart">Lavora da Casa</option>
                          <option value="studio">Permesso Studio</option>
                          <option value="donazione">Permesso Donazione</option>
                          <option value="elettorale">Permesso Elettorale</option>
                        </>
                      )}
                    </select>
                  </div>

                  {(tipoRichiesta === 'permesso' || tipoRichiesta === 'assenza') && (
                    <div className="bg-white/40 p-4 rounded-2xl border border-green-150 space-y-4 animate-in fade-in duration-200">
                      <label className="block text-xs font-black text-green-950 uppercase tracking-wider">
                        {tipoRichiesta === 'assenza' ? 'Frazionamento Assenza' : 'Frazionamento Permesso'}
                      </label>
                      <div className="grid grid-cols-2 gap-2.5">
                        {[
                          { value: 'giornata', label: 'Giornata Intera' },
                          { value: 'mattina', label: 'Solo Mattina (AM)' },
                          { value: 'pomeriggio', label: 'Solo Pomeriggio (PM)' },
                          { value: 'orario', label: 'Orario Specifico' }
                        ].map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => setFrazioneTipo(item.value as any)}
                            className={`p-3 rounded-xl border text-xs font-bold text-center transition-all ${
                              frazioneTipo === item.value
                                ? 'bg-green-600 text-white border-transparent shadow-sm'
                                : 'bg-white/60 text-green-900 border-green-100 hover:bg-white'
                            }`}
                          >
                            {item.value === frazioneTipo && <span className="mr-1">✓</span>}
                            {item.label}
                          </button>
                        ))}
                      </div>
                      {frazioneTipo === 'orario' && (
                        <div className="space-y-4 pt-2 border-t border-green-100 animate-in slide-in-from-top-2 duration-200">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-bold text-green-900 mb-1 ml-1">Ora Inizio</label>
                              <select 
                                required 
                                value={oraInizio}
                                onChange={e => setOraInizio(e.target.value)}
                                className="w-full p-3 border-none rounded-xl bg-white/70 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-bold text-green-900 text-xs cursor-pointer"
                              >
                                {TIME_OPTIONS.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-green-900 mb-1 ml-1">Ora Fine</label>
                              <select 
                                required 
                                value={oraFine}
                                onChange={e => setOraFine(e.target.value)}
                                className="w-full p-3 border-none rounded-xl bg-white/70 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-bold text-green-900 text-xs cursor-pointer"
                              >
                                {TIME_OPTIONS.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 bg-white/50 p-3 rounded-xl border border-green-100/50">
                            <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-green-950 select-none">
                              <input 
                                type="checkbox" 
                                checked={pausaPranzo}
                                onChange={e => setPausaPranzo(e.target.checked)}
                                className="w-4.5 h-4.5 rounded border-green-200 text-green-600 focus:ring-green-500 cursor-pointer"
                              />
                              <span>Pausa pranzo all'interno della fascia oraria</span>
                            </label>
                          </div>

                          {pausaPranzo && (
                            <div className="animate-in slide-in-from-top-2 duration-200">
                              <label className="block text-xs font-bold text-green-900 mb-1 ml-1">Durata pausa pranzo da sottrarre</label>
                              <select 
                                value={pausaPranzoOre}
                                onChange={e => setPausaPranzoOre(e.target.value)}
                                className="w-full p-3 border-none rounded-xl bg-white/70 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-bold text-green-900 text-xs cursor-pointer"
                              >
                                {PAUSA_PRANZO_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  
                  <button 
                    type="submit" 
                    disabled={loading}
                    className="w-full bg-green-600 text-white font-bold py-4 rounded-xl hover:bg-green-700 transition shadow-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100 mt-4"
                  >
                    {loading ? 'Invio in corso...' : 'Invia Richiesta'}
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* LISTA E REGISTRO RICHIESTE */}
          <div className="bg-white/70 backdrop-blur-xl p-6 sm:p-8 rounded-3xl border border-gray-100 shadow-sm flex flex-col h-full">
            <div className="flex flex-col gap-4 h-full">
              <div className="pb-3 border-b border-gray-150">
                <h3 className="font-extrabold text-xl text-gray-900 flex items-center gap-2">
                  {isHR ? "Gestione e Registro Permessi" : "Registro Ferie e Permessi"}
                  {pendingCount > 0 && (
                    <span className="bg-amber-500 text-white text-xs font-black px-2.5 py-0.5 rounded-full shadow-xs">
                      {pendingCount}
                    </span>
                  )}
                </h3>
                <p className="text-xs text-gray-500 font-medium mt-0.5">
                  {isHR ? "Consulta e gestisci le richieste pervenute ed i cambi approvati" : "Filtra le tue richieste ed invia modifiche per i permessi approvati"}
                </p>
              </div>

              {/* TAB DI FILTRAGGIO */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 pb-2.5">
              {[
                { id: 'tutte', label: 'Tutte', count: (isHR ? hrRichieste : requestsList.filter(r => r.dipendenteName === myAssociatedName)).length },
                { id: 'in_attesa', label: 'In Attesa / Modifiche', count: (isHR ? hrRichieste : requestsList.filter(r => r.dipendenteName === myAssociatedName)).filter(r => r.stato === 'In attesa' || r.stato === 'Richiesta Annullamento' || r.stato === 'Richiesta Modifica').length },
                { id: 'approvate', label: 'Approvate', count: (isHR ? hrRichieste : requestsList.filter(r => r.dipendenteName === myAssociatedName)).filter(r => r.stato === 'Approvato').length },
                { id: 'storico', label: 'Rifiutate', count: (isHR ? hrRichieste : requestsList.filter(r => r.dipendenteName === myAssociatedName)).filter(r => r.stato === 'Rifiutato').length }
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRequestTab(tab.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                    requestTab === tab.id
                      ? 'bg-green-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[9.5px] ${requestTab === tab.id ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-700'}`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* LISTA CARD RICHIESTE */}
            <div className="space-y-3 flex-1 overflow-y-auto pr-1 max-h-[460px] custom-scrollbar">
              {filteredRequestsList.length === 0 ? (
                <div className="text-center text-gray-400 py-10 font-medium bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 text-xs">
                  Nessuna richiesta presente per i filtri correnti.
                </div>
              ) : (
                filteredRequestsList.map(req => {
                  const isMyReq = req.dipendenteName === myAssociatedName;
                  const hasModificationPending = req.stato === 'Richiesta Annullamento' || req.stato === 'Richiesta Modifica';

                  return (
                    <div 
                      key={req.id} 
                      className={`p-3.5 sm:p-4 border rounded-2xl transition-all flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 ${
                        hasModificationPending 
                          ? 'bg-amber-50/70 border-amber-200 shadow-xs' 
                          : 'bg-white border-slate-200/80 shadow-2xs hover:shadow-xs'
                      }`}
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-sm text-gray-900 truncate">{req.dipendenteName}</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-extrabold text-gray-700 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200/60">
                            {req.dataInizio && req.dataFine && req.dataInizio !== req.dataFine 
                              ? `Dal ${formatDate(req.dataInizio)} al ${formatDate(req.dataFine)}${(req.tipo === 'permesso' || req.tipo === 'assenza') && req.oraInizio && req.oraFine ? ` (${req.oraInizio}-${req.oraFine}${req.pausaPranzo && req.pausaPranzoOre ? `, esc. pranzo ${req.pausaPranzoOre.toString().replace('.', ',')}h` : ''})` : ''}`
                              : (req.tipo === 'permesso' || req.tipo === 'assenza') && req.oraInizio && req.oraFine
                                ? `Il ${formatDate(req.dataInizio || req.data)} dalle ${req.oraInizio} alle ${req.oraFine}${req.pausaPranzo && req.pausaPranzoOre ? ` (esc. pranzo ${req.pausaPranzoOre.toString().replace('.', ',')}h)` : ''}`
                                : `Il ${formatDate(req.dataInizio || req.data)}`}
                          </span>
                          {getTipoLabel(req.tipo, req.frazioneTipo, req.dipendenteName)}
                        </div>

                        {/* ANTEPRIMA MODIFICA RICHIESTA (SE IN ATTESA DI ANNULLAMENTO/MODIFICA) */}
                        {req.richiestaModifica && (
                          <div className="mt-1.5 p-2.5 bg-amber-100/60 border border-amber-200 rounded-xl text-xs space-y-0.5 text-amber-950">
                            <div className="font-black flex items-center gap-1 text-amber-900 uppercase text-[10px]">
                              <AlertTriangle className="w-3 h-3 text-amber-600" />
                              <span>{req.richiestaModifica.tipoAzione === 'annullamento' ? 'Richiesta di Annullamento' : 'Richiesta di Modifica'}</span>
                            </div>
                            {req.richiestaModifica.tipoAzione === 'modifica' && (
                              <div className="font-bold text-amber-900 text-[11px]">
                                Nuovo Periodo: Dal {formatDate(req.richiestaModifica.nuovaDataInizio || '')} al {formatDate(req.richiestaModifica.nuovaDataFine || '')}
                              </div>
                            )}
                            {req.richiestaModifica.motivazione && (
                              <div className="italic text-amber-900/90 font-medium text-[10.5px]">
                                "{req.richiestaModifica.motivazione}"
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col items-start sm:items-end justify-between w-full sm:w-auto gap-2 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0">
                        <div className="flex items-center gap-2">
                          {getStatusBadge(req.stato)}
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* AZIONE DIPENDENTE SU RICHIESTA APPROVATA: MODIFICA / ANNULLA (MATITINA) */}
                          {isMyReq && req.stato === 'Approvato' && (
                            <button
                              type="button"
                              onClick={() => openModificationModal(req)}
                              className="flex items-center gap-1 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300/80 rounded-lg text-[11px] font-extrabold transition-all shadow-2xs hover:shadow-xs active:scale-95 cursor-pointer"
                              title="Richiedi modifica o annullamento all'HR (Chiara)"
                            >
                              <Pencil className="w-3 h-3 text-amber-700" />
                              <span>Modifica / Annulla</span>
                            </button>
                          )}

                          {/* AZIONE DIPENDENTE SU RICHIESTA IN ATTESA: ANNULLA BOZZA */}
                          {isMyReq && req.stato === 'In attesa' && (
                            <button
                              type="button"
                              onClick={() => handleWithdrawPendingRequest(req.id)}
                              className="flex items-center gap-1 px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-[11px] font-extrabold transition active:scale-95 cursor-pointer"
                              title="Ritira la richiesta in attesa"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Ritira</span>
                            </button>
                          )}

                          {/* AZIONI HR PER RICHIESTE IN ATTESA */}
                          {(isHR || isAdmin) && req.stato === 'In attesa' && (
                            <div className="flex gap-1.5">
                              <button 
                                onClick={() => handleDecision(req.id, true)} 
                                className="px-2.5 py-1 text-[11px] font-extrabold bg-green-600 hover:bg-green-700 text-white rounded-lg transition shadow-2xs active:scale-95 cursor-pointer"
                              >
                                Approva
                              </button>
                              <button 
                                onClick={() => handleDecision(req.id, false)} 
                                className="px-2.5 py-1 text-[11px] font-extrabold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition shadow-2xs active:scale-95 cursor-pointer"
                              >
                                Rifiuta
                              </button>
                            </div>
                          )}

                          {/* AZIONI HR PER RICHIESTE DI ANNULLAMENTO / MODIFICA */}
                          {(isHR || isAdmin) && (req.stato === 'Richiesta Annullamento' || req.stato === 'Richiesta Modifica') && (
                            <div className="flex flex-wrap gap-1.5">
                              {req.stato === 'Richiesta Annullamento' ? (
                                <button 
                                  onClick={() => handleHRApproveCancellation(req)} 
                                  className="px-2.5 py-1 text-[11px] font-extrabold bg-red-600 hover:bg-red-700 text-white rounded-lg transition shadow-2xs active:scale-95 cursor-pointer"
                                >
                                  Conferma Annullamento
                                </button>
                              ) : (
                                <button 
                                  onClick={() => handleHRApproveModification(req)} 
                                  className="px-2.5 py-1 text-[11px] font-extrabold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition shadow-2xs active:scale-95 cursor-pointer"
                                >
                                  Applica Modifica
                                </button>
                              )}
                              <button 
                                onClick={() => handleHRRejectModificationOrCancellation(req)} 
                                className="px-2 py-1 text-[11px] font-bold bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg transition cursor-pointer"
                              >
                                Rifiuta Cambio
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>

      {/* CALENDARIO VIEW */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 no-print">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-extrabold text-2xl text-gray-900 capitalize">{monthName}</h3>
          <div className="flex flex-wrap items-center gap-3">
            {/* Navigatore Mese */}
            <div className="flex items-center gap-1 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm">
              <button onClick={() => shiftMonth(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition"><ChevronLeft className="w-5 h-5" /></button>
              <button onClick={() => setCurrentMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="px-4 py-2 text-sm font-extrabold text-gray-700 hover:bg-gray-100 rounded-lg transition">Oggi</button>
              <button onClick={() => shiftMonth(1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition"><ChevronRight className="w-5 h-5" /></button>
            </div>

            {/* Selettore Vista */}
            <div className="bg-gray-150 p-1.5 rounded-2xl flex gap-1.5 border border-gray-200 shadow-inner">
              <button 
                onClick={() => setViewMode('calendario')}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                  viewMode === 'calendario' 
                    ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50' 
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Calendario
              </button>
              <button 
                onClick={() => setViewMode('tabella')}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                  viewMode === 'tabella' 
                    ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50' 
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Griglia Risorse
              </button>
            </div>
            
            {/* Bottone Stampa */}
            <button onClick={handlePrintFeriePlan} className="hidden md:flex items-center gap-2 bg-gray-900 text-white hover:bg-gray-800 px-5 py-2.5 rounded-xl font-bold transition shadow-lg active:scale-95 cursor-pointer">
              Stampa
            </button>
          </div>
        </div>

        {viewMode === 'calendario' ? (
          <>
            <div className="grid grid-cols-7 gap-2 mb-2">
              {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => (
                <div key={d} className="text-center font-bold text-gray-400 text-sm py-2">{d}</div>
              ))}
            </div>
            
            <div className="grid grid-cols-7 gap-2">
              {calendarCells}
            </div>

            <div className="mt-8 flex flex-wrap gap-4 p-4 bg-gray-50 rounded-2xl border border-gray-100 justify-center">
              <div className="text-sm font-bold text-gray-500 mr-2">Legenda Colori:</div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700"><span className="w-3 h-3 rounded-full bg-sky-400 shadow-sm"></span> Ferie (Dipendenti)/Assenza (Collaboratori P.IVA)</div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700"><span className="w-3 h-3 rounded-full bg-amber-400 shadow-sm"></span> Permesso dipendenti/Assenza oraria Collaboratori</div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700"><span className="w-3 h-3 rounded-full bg-red-400 shadow-sm"></span> Malattia/Maternità</div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700"><span className="w-3 h-3 rounded-full bg-lime-500 shadow-sm"></span> Lavoro da Casa</div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700"><span className="w-3 h-3 rounded-full bg-yellow-300 shadow-sm"></span> In attesa</div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700"><span className="w-3 h-3 rounded-full bg-green-400 shadow-sm"></span> Approvato</div>
            </div>
          </>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm mt-4">
              <table className="w-full text-left border-collapse min-w-[900px] table-fixed">
                <colgroup>
                  <col className="w-[180px]" />
                  {Array.from({ length: 31 }).map((_, idx) => (
                    <col key={idx} className="w-[30px]" />
                  ))}
                </colgroup>
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="p-3 text-xs font-bold text-gray-550 uppercase sticky left-0 bg-gray-50 z-10 border-r border-gray-200">ELENCO PERSONALE</th>
                    {Array.from({ length: 31 }).map((_, i) => {
                      const day = i + 1;
                      if (day > daysInMonth) return <th key={i} className="bg-gray-100"></th>;
                      const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const isWknd = isWeekend(dateStr);
                      const isHoliday = isItalianHoliday(dateStr);
                      const isSpecialDay = isWknd || isHoliday;

                      let thStyle: React.CSSProperties = {};
                      let thClass = "p-2 text-center text-xs font-bold border-r border-gray-200";

                      if (isSpecialDay) {
                        thStyle = { background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)' };
                        thClass += " text-gray-500";
                      } else {
                        thClass += " text-gray-500";
                      }

                      return (
                        <th key={i} style={thStyle} className={thClass}>
                          {day}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-medium text-gray-900 text-xs">
                  {(() => {
                    const firstDayOfMonthStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-01`;
                    const sortedDipendenti = dipendenti
                      .filter(d => !d.dataCessazione || d.dataCessazione >= firstDayOfMonthStr)
                      .sort((a, b) => a.nome.trim().localeCompare(b.nome.trim()));
                    return sortedDipendenti.map(dip => {
                      return (
                        <tr key={dip.id} className="hover:bg-gray-50/40 transition-colors">
                          <td className="p-3 font-bold text-gray-800 sticky left-0 bg-white border-r border-gray-200 shadow-[2px_0_5px_rgba(0,0,0,0.03)] truncate z-10">
                            {dip.nome}
                          </td>
                          {Array.from({ length: 31 }).map((_, i) => {
                            const day = i + 1;
                            if (day > daysInMonth) return <td key={i} className="bg-gray-50 border-r border-gray-150"></td>;

                            const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                            const isWknd = isWeekend(dateStr);
                            const isHoliday = isItalianHoliday(dateStr);

                            const isUnlocked = approvedWeekends[`${dip.nome}_${dateStr}`];
                            const isSpecialDay = (isWknd || isHoliday) && !isUnlocked;

                            const req = richieste.find(r => {
                               if (r.stato === 'Rifiutato') return false;
                               const start = r.dataInizio || r.data;
                               const end = r.dataFine || r.data;
                               return start && end && dateStr >= start && dateStr <= end && r.dipendenteName === dip.nome;
                             });

                            let cellBg = '';
                            let cellStyle: React.CSSProperties = {};
                            let cellText = '';
                            let titleStr = `${dip.nome} - ${day}/${currentMonth.getMonth() + 1}`;

                            const isCessato = dip.dataCessazione && dateStr > dip.dataCessazione;

                            if (isCessato) {
                              cellBg = 'text-white text-center font-bold bg-gray-500';
                              cellStyle = { background: 'linear-gradient(135deg, #4b5563 0%, #374151 100%)' };
                              cellText = 'X';
                              titleStr += '\nRisorsa cessata / inattiva';
                            } else if (isSpecialDay) {
                              cellBg = 'text-gray-400';
                              cellStyle = { background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)' };
                            } else if (req) {
                              const isApproved = req.stato === 'Approvato';
                              const isRejected = req.stato === 'Rifiutato';

                              titleStr += `\nStato: ${req.stato}\nTipo: ${getTipoData(req.tipo, req.frazioneTipo, dip.nome).label}`;
                              if ((req.tipo === 'permesso' || req.tipo === 'assenza') && req.oraInizio && req.oraFine && req.frazioneTipo !== 'mattina' && req.frazioneTipo !== 'pomeriggio' && req.frazioneTipo !== 'giornata') {
                                titleStr += `\nOrario: dalle ${req.oraInizio} alle ${req.oraFine}${req.pausaPranzo && req.pausaPranzoOre ? ` (esclusa p. pranzo ${req.pausaPranzoOre.toString().replace('.', ',')}h)` : ''}`;
                              }
                              if (req.note) titleStr += `\nNote: ${req.note}`;

                              if (isRejected) {
                                cellBg = 'bg-red-50 border-red-200 text-red-800/60 line-through opacity-50';
                              } else if (req.tipo === 'ferie' || (req.tipo === 'assenza' && (!req.frazioneTipo || req.frazioneTipo === 'giornata'))) {
                                cellBg = isApproved 
                                  ? 'bg-sky-500 hover:bg-sky-600 border-sky-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = '';
                              } else if (['malattia', 'maternita'].includes(req.tipo)) {
                                cellBg = isApproved 
                                  ? 'bg-red-500 hover:bg-red-600 border-red-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = 'M';
                              } else if (req.tipo === 'smart') {
                                cellBg = isApproved 
                                  ? 'bg-emerald-500 hover:bg-emerald-600 border-emerald-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                              } else if (['mattina', 'pomeriggio', 'permesso', 'assenza'].includes(req.tipo)) {
                                cellBg = isApproved 
                                  ? 'bg-amber-400 hover:bg-amber-500 border-amber-500 text-amber-950 font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                
                                if (req.tipo === 'mattina' || req.frazioneTipo === 'mattina') {
                                  cellText = 'AM';
                                } else if (req.tipo === 'pomeriggio' || req.frazioneTipo === 'pomeriggio') {
                                  cellText = 'PM';
                                } else if (req.frazioneTipo === 'giornata') {
                                  cellText = 'GI';
                                } else if (req.oraInizio && req.oraFine) {
                                  const [hStart, mStart] = req.oraInizio.split(':').map(Number);
                                  const [hEnd, mEnd] = req.oraFine.split(':').map(Number);
                                  const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
                                  let hrs = Math.round((diffMs / 3600000) * 100) / 100;
                                  if (req.pausaPranzo && req.pausaPranzoOre) {
                                    hrs = Math.max(0, hrs - req.pausaPranzoOre);
                                  }
                                  cellText = `${hrs.toString().replace('.', ',')}h`;
                                } else {
                                  cellText = '';
                                }
                              } else if (req.tipo === 'studio') {
                                cellBg = isApproved 
                                  ? 'bg-purple-500 hover:bg-purple-600 border-purple-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = 'S';
                              } else if (req.tipo === 'donazione') {
                                cellBg = isApproved 
                                  ? 'bg-teal-500 hover:bg-teal-600 border-teal-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = 'D';
                              } else if (req.tipo === 'elettorale') {
                                cellBg = isApproved 
                                  ? 'bg-indigo-500 hover:bg-indigo-600 border-indigo-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = 'E';
                              }
                            }

                            const isClickable = !!req && (isHR || isAdmin) && !isSpecialDay && !isCessato;

                            return (
                              <td 
                                key={i} 
                                onClick={() => {
                                  if (isClickable) {
                                    setCancellationRequest(req);
                                    setCancellationReason('');
                                  }
                                }}
                                title={titleStr}
                                style={cellStyle}
                                className={`p-1.5 text-center border-r border-gray-200 transition-all ${cellBg} ${isClickable ? 'cursor-pointer select-none font-extrabold' : ''}`}
                              >
                                {cellText}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>

            {/* Legend for resources grid */}
            <div className="mt-6 flex flex-wrap gap-4 p-5 bg-gray-50 rounded-2xl border border-gray-100 justify-center">
              <div className="text-xs font-bold text-gray-500 mr-2 self-center">Legenda Colori (Approvati):</div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-6 h-4 rounded border border-sky-600 bg-sky-500"></span> Ferie (Dipendenti)/Assenza (Collaboratori P.IVA)
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-6 h-4 rounded border border-amber-500 bg-amber-400"></span> Permesso dipendenti/Assenza oraria Collaboratori
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-6 h-4 rounded border border-red-600 bg-red-500 flex items-center justify-center text-[10px] font-black text-white">M</span> Malattia/Maternità
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-6 h-4 rounded border border-emerald-600 bg-emerald-500"></span> Lavoro da casa
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-6 h-4 rounded border border-purple-600 bg-purple-500 flex items-center justify-center text-[10px] font-black text-white">S</span> Permesso Studio
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-6 h-4 rounded border border-teal-600 bg-teal-500 flex items-center justify-center text-[10px] font-black text-white">D</span> Permesso Donazione
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-6 h-4 rounded border border-indigo-600 bg-indigo-500 flex items-center justify-center text-[10px] font-black text-white">E</span> Permesso Elettorale
              </div>
            </div>
          </>
        )}
      </div>

      {/* MODALE RICHIESTA MODIFICA / ANNULLAMENTO FERIE APPROVATE PER DIPENDENTE */}
      {modifyingRequest && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center z-[9999] p-4 sm:p-6 no-print animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-xl border border-gray-100 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            
            {/* Header Modale */}
            <div className="p-5 sm:p-6 border-b bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-white flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <Pencil className="w-5 h-5 text-amber-200" />
                <h3 className="text-lg font-black tracking-tight">Richiesta Modifica / Annullamento</h3>
              </div>
              <button
                type="button"
                onClick={() => setModifyingRequest(null)}
                className="text-white/80 hover:text-white p-1 hover:bg-white/10 rounded-full transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-5 overflow-y-auto max-h-[80vh]">
              {/* Card di Riepilogo Richiesta Approvata Attuale */}
              <div className="bg-amber-50/80 border border-amber-200 p-4 rounded-2xl space-y-1 text-xs">
                <div className="font-extrabold text-amber-950 text-sm">{modifyingRequest.dipendenteName}</div>
                <div className="font-bold text-amber-900">
                  {modifyingRequest.dataInizio && modifyingRequest.dataFine && modifyingRequest.dataInizio !== modifyingRequest.dataFine
                    ? `Periodo Approvato: Dal ${formatDate(modifyingRequest.dataInizio)} al ${formatDate(modifyingRequest.dataFine)}`
                    : `Giorno Approvato: ${formatDate(modifyingRequest.dataInizio || modifyingRequest.data)}`}
                </div>
                <div className="text-amber-800 font-semibold">
                  Tipo: {getTipoData(modifyingRequest.tipo, modifyingRequest.frazioneTipo, modifyingRequest.dipendenteName).label}
                </div>
              </div>

              {/* Selettore Tipo Azione: Annullamento vs Modifica */}
              <div className="space-y-2">
                <label className="block text-xs font-black text-gray-800 uppercase tracking-wider">Cosa desideri richiedere all'HR (Chiara)?</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setModTipoAzione('annullamento')}
                    className={`p-3.5 rounded-2xl border text-xs font-extrabold text-center transition-all flex flex-col items-center gap-1.5 cursor-pointer ${
                      modTipoAzione === 'annullamento'
                        ? 'bg-red-600 text-white border-transparent shadow-md'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Annulla Ferie Approvate</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModTipoAzione('modifica')}
                    className={`p-3.5 rounded-2xl border text-xs font-extrabold text-center transition-all flex flex-col items-center gap-1.5 cursor-pointer ${
                      modTipoAzione === 'modifica'
                        ? 'bg-indigo-600 text-white border-transparent shadow-md'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Pencil className="w-4 h-4" />
                    <span>Modifica Date / Orari</span>
                  </button>
                </div>
              </div>

              {/* Campi di Modifica se selezionato 'modifica' */}
              {modTipoAzione === 'modifica' && (
                <div className="space-y-3.5 bg-slate-50 p-4 rounded-2xl border border-slate-200 animate-in fade-in duration-200">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Nuova Data Inizio *</label>
                      <input 
                        type="date"
                        value={modDataInizio}
                        onChange={e => setModDataInizio(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-slate-200 text-xs font-bold text-gray-800 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Nuova Data Fine *</label>
                      <input 
                        type="date"
                        value={modDataFine}
                        onChange={e => setModDataFine(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-slate-200 text-xs font-bold text-gray-800 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Tipo Assenza</label>
                    <select
                      value={modTipo}
                      onChange={e => setModTipo(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-slate-200 text-xs font-bold text-gray-800 bg-white outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                    >
                      <option value="ferie">Ferie</option>
                      <option value="permesso">Permesso</option>
                      <option value="malattia">Malattia</option>
                      <option value="smart">Lavora da Casa</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Nota / Motivazione per HR */}
              <div>
                <label className="block text-xs font-bold text-gray-800 mb-1 flex items-center justify-between">
                  <span>Motivazione / Nota per l'HR (Chiara)</span>
                  <span className="text-[10px] text-gray-400 font-normal italic">(Facoltativa)</span>
                </label>
                <textarea
                  placeholder={modTipoAzione === 'annullamento' ? "Spiega all'HR il motivo dell'annullamento delle ferie..." : "Spiega all'HR il motivo della modifica del periodo..."}
                  value={modMotivazione}
                  onChange={e => setModMotivazione(e.target.value)}
                  rows={3}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                />
              </div>
            </div>

            {/* Footer Modale */}
            <div className="p-4 border-t border-gray-150 flex gap-3 bg-gray-50">
              <button
                type="button"
                onClick={() => setModifyingRequest(null)}
                className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-100 transition cursor-pointer"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleSendModificationRequest}
                disabled={modLoading}
                className="flex-1 py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold transition shadow-md disabled:opacity-50 cursor-pointer"
              >
                {modLoading ? "Invio in corso..." : "Invia Richiesta all'HR"}
              </button>
            </div>

          </div>
        </div>
      )}

      {cancellationRequest && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-6 sm:p-8 max-w-md w-full animate-in fade-in zoom-in-95 duration-200 flex flex-col gap-5">
            <div>
              <h4 className="font-extrabold text-xl text-gray-900">Annulla Richiesta Assenza</h4>
              <p className="text-xs text-gray-500 mt-1">Stai per eliminare definitivamente questa richiesta approvata o in attesa.</p>
            </div>

            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100/50 text-xs text-gray-700 space-y-2 font-medium">
              <div><strong>Dipendente:</strong> {cancellationRequest.dipendenteName}</div>
              <div><strong>Tipo Assenza:</strong> <span className="capitalize">{getTipoData(cancellationRequest.tipo, cancellationRequest.frazioneTipo).label}</span></div>
              <div>
                <strong>Periodo:</strong> {
                  (() => {
                    let cancelPeriod = cancellationRequest.dataInizio && cancellationRequest.dataFine && cancellationRequest.dataInizio !== cancellationRequest.dataFine 
                      ? `Dal ${formatDate(cancellationRequest.dataInizio)} al ${formatDate(cancellationRequest.dataFine)}` 
                      : `Il ${formatDate(cancellationRequest.dataInizio || cancellationRequest.data)}`;
                    if (cancellationRequest.tipo === 'permesso') {
                      if (cancellationRequest.frazioneTipo === 'mattina') cancelPeriod += ' (mattina)';
                      else if (cancellationRequest.frazioneTipo === 'pomeriggio') cancelPeriod += ' (pomeriggio)';
                      else if (cancellationRequest.frazioneTipo === 'giornata') cancelPeriod += ' (giornata intera)';
                      else if (cancellationRequest.oraInizio && cancellationRequest.oraFine) cancelPeriod += ` dalle ${cancellationRequest.oraInizio} alle ${cancellationRequest.oraFine}${cancellationRequest.pausaPranzo && cancellationRequest.pausaPranzoOre ? ` (esclusa p. pranzo ${cancellationRequest.pausaPranzoOre.toString().replace('.', ',')}h)` : ''}`;
                    }
                    return cancelPeriod;
                  })()
                }
              </div>
              <div><strong>Stato Attuale:</strong> <span className="font-bold">{cancellationRequest.stato}</span></div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-gray-500 ml-1">Motivazione annullamento (facoltativa, inviata via email)</label>
              <textarea
                placeholder="Es: Modifica della pianificazione o delle attività concordata con il dipendente..."
                value={cancellationReason}
                onChange={e => setCancellationReason(e.target.value)}
                className="w-full p-3 border-none bg-gray-50 focus:bg-gray-100 rounded-xl text-xs outline-none focus:ring-2 focus:ring-red-500 shadow-inner font-semibold text-gray-700 min-h-[90px] resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => {
                  setCancellationRequest(null);
                  setCancellationReason('');
                }}
                disabled={cancellationLoading}
                className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-xs font-bold text-gray-655 hover:bg-gray-50 transition active:scale-95 disabled:opacity-50"
              >
                Annulla
              </button>
              <button 
                onClick={handleCancelApprovedLeave}
                disabled={cancellationLoading}
                className="flex-1 py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition active:scale-95 disabled:opacity-50 shadow-md shadow-red-200"
              >
                {cancellationLoading ? 'Elaborazione...' : 'Elimina Assenza'}
              </button>
            </div>
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
    </div>
  );
});

export default function Ferie() {
  const { isHR, isAdmin, myAssociatedName, dipendenti } = useAuth();
  return (
    <FerieContent 
      isHR={!!isHR} 
      isAdmin={!!isAdmin} 
      myAssociatedName={myAssociatedName || ''} 
      dipendenti={dipendenti} 
    />
  );
}
