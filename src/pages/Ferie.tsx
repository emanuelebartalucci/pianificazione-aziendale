import { useState, useEffect, useMemo, memo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, doc, updateDoc, deleteDoc, query, where, getDocs } from 'firebase/firestore';
import { Calendar, CheckCircle, XCircle, Clock, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { queueMail } from '../utils/mailSender';
import { isItalianHoliday, isWeekend } from '../utils/date';

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
  stato: 'In attesa' | 'Approvato' | 'Rifiutato';
  frazioneTipo?: 'mattina' | 'pomeriggio' | 'giornata' | 'orario';
  dataInizio?: string;
  dataFine?: string;
  oraInizio?: string;
  oraFine?: string;
  timestamp?: string;
  note?: string;
  comunicazioneId?: string;
}

const TIME_OPTIONS = Array.from({ length: 48 }).map((_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
});

interface FerieContentProps {
  isHR: boolean;
  isAdmin: boolean;
  myAssociatedName: string;
  dipendenti: any[];
}

const FerieContent = memo(({ isHR, isAdmin, myAssociatedName, dipendenti }: FerieContentProps) => {
  const [viewMode, setViewMode] = useState<'calendario' | 'tabella'>('calendario');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);
  const [chiusureAziendali, setChiusureAziendali] = useState<Array<{ dataInizio: string; dataFine: string }>>([]);

  const isInChiusuraAziendaleLocal = (dateStr: string) => {
    return chiusureAziendali.some(c => dateStr >= c.dataInizio && dateStr <= c.dataFine);
  };

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
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

  useEffect(() => {
    if (myAssociatedName && !dipendenteSelezionato) {
      setDipendenteSelezionato(myAssociatedName);
    }
  }, [myAssociatedName]);
  
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

      if (isHR || isAdmin) {
        const halfYearAgo = new Date();
        halfYearAgo.setMonth(halfYearAgo.getMonth() - 6);
        const startLimit = halfYearAgo.toLocaleDateString('sv-SE');

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
            tipo: data.tipo,
            stato: data.stato || 'In attesa',
            frazioneTipo: data.frazioneTipo,
            dataInizio: data.dataInizio,
            dataFine: data.dataFine,
            oraInizio: data.oraInizio,
            oraFine: data.oraFine,
            timestamp: data.timestamp,
            note: data.note || '',
            comunicazioneId: data.comunicazioneId || ''
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
            tipo: data.tipo,
            stato: data.stato || 'In attesa',
            frazioneTipo: data.frazioneTipo,
            dataInizio: data.dataInizio,
            dataFine: data.dataFine,
            oraInizio: data.oraInizio,
            oraFine: data.oraFine,
            timestamp: data.timestamp,
            note: data.note || '',
            comunicazioneId: data.comunicazioneId || ''
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
            tipo: data.tipo,
            stato: data.stato || 'In attesa',
            frazioneTipo: data.frazioneTipo,
            dataInizio: data.dataInizio,
            dataFine: data.dataFine,
            oraInizio: data.oraInizio,
            oraFine: data.oraFine,
            timestamp: data.timestamp,
            note: data.note || '',
            comunicazioneId: data.comunicazioneId || ''
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

  const listRichieste = useMemo(() => {
    if (isHR) {
      // Ottieni la data odierna nel formato YYYY-MM-DD
      const todayStr = new Date().toLocaleDateString('sv-SE'); // Formato YYYY-MM-DD
      return richieste.filter(r => {
        const dateLimit = r.dataFine || r.dataInizio || r.data || '';
        return (!dateLimit || dateLimit >= todayStr) && r.note !== 'Chiusure Aziendali' && r.stato === 'In attesa';
      });
    }
    // For regular users, show only their own requests in the list (approved of others are calendar-only)
    return richieste
      .filter(r => r.dipendenteName === myAssociatedName && r.note !== 'Chiusure Aziendali')
      .slice(0, 10);
  }, [richieste, isHR, myAssociatedName]);

  const pendingCount = useMemo(() => {
    return listRichieste.filter(r => r.stato === 'In attesa').length;
  }, [listRichieste]);

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

    if (tipoRichiesta === 'permesso' && frazioneTipo === 'orario') {
      if (!oraInizio || !oraFine) {
        showToast("Inserisci l'ora di inizio e di fine del permesso.", "warning");
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

          const isExistFullDay = ['ferie', 'malattia', 'maternita', 'smart'].includes(exist.tipo) || (exist.tipo === 'permesso' && exist.frazioneTipo === 'giornata');
          const isNewFullDay = ['ferie', 'malattia', 'maternita', 'smart'].includes(tipoRichiesta) || (tipoRichiesta === 'permesso' && frazioneTipo === 'giornata');

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
        if (tipoRichiesta === 'permesso') {
          payload.frazioneTipo = frazioneTipo;
          if (frazioneTipo === 'orario') {
            payload.oraInizio = oraInizio;
            payload.oraFine = oraFine;
          }
        }
      } else {
        payload.data = dataInizio; // legacy fallback
        payload.dataInizio = dataInizio;
        payload.dataFine = dataFine;
      }
      
      await addDoc(collection(db, 'richieste_ferie'), payload);
      
      setDataRichiesta('');
      setDataInizio('');
      setDataFine('');
      setOraInizio('09:00');
      setOraFine('18:00');
      setFrazioneTipo('giornata');
      showToast("Richiesta inviata con successo!");
      loadFerieData();
    } catch (err) {
      showToast("Errore nell'invio della richiesta.", "error");
    } finally {
      setLoading(false);
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

      // Invia notifica e-mail al dipendente
      const targetDip = dipendenti.find(d => d.nome === req.dipendenteName);
      if (targetDip && targetDip.email) {
        let dateDesc = req.dataInizio && req.dataFine && req.dataInizio !== req.dataFine 
          ? `dal ${formatDate(req.dataInizio)} al ${formatDate(req.dataFine)}` 
          : `il ${formatDate(req.dataInizio || req.data)}`;
        
        if (req.tipo === 'permesso') {
          if (req.frazioneTipo === 'mattina') dateDesc += ' (mattina)';
          else if (req.frazioneTipo === 'pomeriggio') dateDesc += ' (pomeriggio)';
          else if (req.frazioneTipo === 'giornata') dateDesc += ' (giornata intera)';
          else if (req.oraInizio && req.oraFine) dateDesc += ` dalle ${req.oraInizio} alle ${req.oraFine}`;
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

        await queueMail(targetDip.email.toLowerCase(), subject, htmlBody, plainText);
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
        
        if (req.tipo === 'permesso') {
          if (req.frazioneTipo === 'mattina') dateDesc += ' (mattina)';
          else if (req.frazioneTipo === 'pomeriggio') dateDesc += ' (pomeriggio)';
          else if (req.frazioneTipo === 'giornata') dateDesc += ' (giornata intera)';
          else if (req.oraInizio && req.oraFine) dateDesc += ` dalle ${req.oraInizio} alle ${req.oraFine}`;
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

        await queueMail(targetDip.email.toLowerCase(), subject, htmlBody, plainText);
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

  const getStatusBadge = (stato: string) => {
    switch(stato) {
      case 'Approvato': return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-green-100 text-green-700 px-2 py-1 rounded-full"><CheckCircle className="w-3 h-3"/> {stato}</span>;
      case 'Rifiutato': return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full"><XCircle className="w-3 h-3"/> {stato}</span>;
      default: return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full"><Clock className="w-3 h-3"/> {stato}</span>;
    }
  };

  const getTipoData = (tipo: string, frazioneTipo?: string) => {
    const tipi: Record<string, {label: string, color: string}> = {
      ferie: {label: 'Ferie', color: 'bg-red-500'},
      malattia: {label: 'Malattia', color: 'bg-purple-600'},
      maternita: {label: 'Maternità', color: 'bg-pink-500'},
      permesso: {label: 'Permesso', color: 'bg-amber-500'},
      smart: {label: 'Lavora da Casa', color: 'bg-blue-500'},
      mattina: {label: 'Assenza Mattina', color: 'bg-amber-500'},
      pomeriggio: {label: 'Assenza Pomeriggio', color: 'bg-amber-500'},
      studio: {label: 'Permesso Studio', color: 'bg-violet-600'},
      donazione: {label: 'Permesso Donazione', color: 'bg-teal-500'},
      elettorale: {label: 'Permesso Elettorale', color: 'bg-indigo-500'}
    };
    const base = tipi[tipo] || {label: tipo, color: 'bg-gray-500'};
    if (tipo === 'permesso' && frazioneTipo) {
      const copy = { ...base };
      if (frazioneTipo === 'mattina') copy.label = 'Permesso Mattina';
      if (frazioneTipo === 'pomeriggio') copy.label = 'Permesso Pomeriggio';
      if (frazioneTipo === 'giornata') copy.label = 'Permesso Giornata Intera';
      if (frazioneTipo === 'orario') copy.label = 'Permesso Orario';
      return copy;
    }
    return base;
  };

  const getTipoLabel = (tipo: string, frazioneTipo?: string) => {
    const t = getTipoData(tipo, frazioneTipo);
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
      if (req.stato !== 'Approvato') return;
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
          cellBg = '#f3f4f6'; // Grigio weekend
          textColor = '#9ca3af';
        } else if (tipo) {
          if (tipo === 'ferie') {
            cellBg = '#38bdf8'; // Sky Blue (Ferie)
            textColor = '#ffffff';
          } else if (['malattia', 'maternita'].includes(tipo)) {
            cellBg = '#ef4444'; // Rosso (Malattia)
            cellText = 'M';
            textColor = '#ffffff';
          } else if (tipo === 'smart') {
            cellBg = '#84cc16'; // Verde (Smart Working)
            textColor = '#ffffff';
          } else if (['mattina', 'pomeriggio', 'permesso'].includes(tipo)) {
            cellBg = '#facc15'; // Giallo
            textColor = '#713f12';
            
            if (tipo === 'mattina' || reqObj.frazioneTipo === 'mattina') {
              cellText = 'AM';
            } else if (tipo === 'pomeriggio' || reqObj.frazioneTipo === 'pomeriggio') {
              cellText = 'PM';
            } else if (reqObj.frazioneTipo === 'giornata') {
              cellText = 'GI';
            } else if (reqObj.oraInizio && reqObj.oraFine) {
              const [hStart, mStart] = reqObj.oraInizio.split(':').map(Number);
              const [hEnd, mEnd] = reqObj.oraFine.split(':').map(Number);
              const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
              const hrs = Math.round((diffMs / 3600000) * 100) / 100;
              cellText = `${hrs.toString().replace('.', ',')}h`;
            } else {
              cellText = 'P';
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
      if (day > numDays) return '<th></th>';
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dateObj = new Date(year, month, day);
      const dayOfWeek = dateObj.getDay();
      const isWknd = dayOfWeek === 0 || dayOfWeek === 6;
      const isHoliday = isItalianHoliday(dateStr);
      const classAttr = (isWknd || isHoliday) ? ' class="wknd-hdr"' : '';
      return `<th${classAttr}>${day}</th>`;
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
              color-adjust: exact !important;
              box-sizing: border-box;
            }
            @page {
              size: A4 portrait;
              margin: 0.6cm;
            }
            html, body {
              height: 99%;
              margin: 0;
              padding: 0;
              font-family: 'Inter', -apple-system, sans-serif;
              color: #1f2937;
              font-size: 7px;
            }
            .container {
              display: flex;
              flex-direction: column;
              height: 100%;
              justify-content: space-between;
            }
            .header-container {
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
              border-bottom: 2px solid #111827;
              padding-bottom: 8px;
              margin-bottom: 12px;
            }
            .header-left {
              display: flex;
              flex-direction: column;
            }
            .title-main {
              font-weight: 900;
              font-size: 21px;
              letter-spacing: -0.02em;
              color: #111827;
              text-transform: uppercase;
            }
            .title-sub {
              font-weight: 700;
              font-size: 9.5px;
              color: #6b7280;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              margin-top: 1px;
            }
            .logo-img {
              height: 38px;
              object-fit: contain;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
              border: 0.5px solid #d1d5db;
            }
            tr {
              background-color: #ffffff !important;
            }
            th, td {
              border: 0.5px solid #e5e7eb;
              padding: 3.5px 0;
              text-align: center;
              font-size: 6px;
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
              padding-left: 5px;
              font-weight: 750;
              font-size: 6.5px;
              color: #111827;
              border-right: 1px solid #d1d5db;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              background-color: #ffffff !important;
            }

            .wknd-hdr {
              background-color: #e5e7eb !important;
              color: #4b5563;
            }
            .empty-cell {
              background-color: #f9fafb !important;
            }
            .legend-box {
              margin-top: 12px;
              border-top: 1px solid #e5e7eb;
              padding-top: 6px;
            }
            .legend-title {
              font-weight: 850;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              margin-bottom: 5px;
              font-size: 7px;
              color: #374151;
            }
            .legend-items {
              display: flex;
              flex-wrap: wrap;
              gap: 4px 10px;
            }
            .legend-item {
              display: flex;
              align-items: center;
              gap: 4px;
              font-size: 6px;
              font-weight: 700;
              color: #4b5563;
              background-color: #f9fafb !important;
              border: 0.5px solid #e5e7eb;
              padding: 2.5px 5px;
              border-radius: 4px;
            }
            .color-block {
              width: 18px;
              height: 9px;
              border-radius: 2px;
              border: 0.5px solid #d1d5db;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              font-size: 5px;
              font-weight: 900;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div>
              <div class="header-container">
                <div class="header-left">
                  <div class="title-main">${monthLabel} ${year}</div>
                  <div class="title-sub">Pianificazione Ferie & Assenze</div>
                </div>
                <div class="header-right">
                  <img src="${window.location.origin}/Logo.png" alt="Logo Ingegno" class="logo-img" />
                </div>
              </div>
              <table>
                <colgroup>
                  <col style="width: 18%;" />
                  ${Array.from({ length: 31 }).map(() => '<col style="width: 2.64%;" />').join('')}
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
                  <span>FERIE</span>
                </div>
                <div class="legend-item">
                  <div class="color-block" style="background-color: #ef4444 !important; color: #ffffff !important;">M</div>
                  <span>MALATTIA/MATERNITÀ</span>
                </div>
                <div class="legend-item">
                  <div class="color-block" style="background-color: #facc15 !important;"></div>
                  <span>PERMESSO (AM: Mattina - PM: Pomeriggio - GI: Giornata Intera)</span>
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
          </div>
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
            const t = getTipoData(req.tipo, req.frazioneTipo);
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
            if (req.tipo === 'permesso') {
              if (req.frazioneTipo === 'mattina') hourSuffix = ' AM';
              else if (req.frazioneTipo === 'pomeriggio') hourSuffix = ' PM';
              else if (req.frazioneTipo === 'giornata') hourSuffix = ' GI';
              else if (req.oraInizio && req.oraFine) hourSuffix = ` (${req.oraInizio}-${req.oraFine})`;
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
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          
          {/* FORM NUOVA RICHIESTA */}
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-8 rounded-3xl border border-green-100 shadow-sm h-fit">
            <h3 className="font-extrabold text-2xl mb-6 text-green-950">Nuova Richiesta Personale</h3>
            
            <div className="bg-emerald-600/10 border border-emerald-500/20 rounded-2xl p-4 mb-5 text-xs text-emerald-950 leading-relaxed font-semibold flex gap-2.5 items-start">
              <span className="w-5 h-5 shrink-0 bg-emerald-600 text-white rounded-full flex items-center justify-center font-extrabold text-[10px]">i</span>
              <div>
                <strong>Nota Importante:</strong> Prima di inoltrare la richiesta all'HR, assicurati di esserti accordato a voce con il tuo superiore diretto. L'HR verificherà la sovrapposizione complessiva delle richieste dando per scontato il preventivo benestare del tuo responsabile.
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
                
                {tipoRichiesta !== 'permesso' ? (
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
                ) : (
                  <div className="bg-white/40 p-3 rounded-xl border border-green-100 text-xs font-bold text-green-800/80">
                    Modalità: Giorno Singolo (obbligatorio per permessi o frazioni di giornata)
                  </div>
                )}

                {requestMode === 'singolo' || tipoRichiesta === 'permesso' ? (
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
                    onChange={e => {
                      const val = e.target.value;
                      setTipoRichiesta(val);
                      if (val === 'permesso') {
                        setRequestMode('singolo');
                      }
                    }}
                    className="w-full p-3.5 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-medium text-green-900"
                  >
                    <option value="ferie">Ferie</option>
                    <option value="permesso">Permesso</option>
                    <option value="malattia">Malattia</option>
                    <option value="maternita">Maternità</option>
                    <option value="smart">Lavora da Casa</option>
                    <option value="studio">Permesso Studio</option>
                    <option value="donazione">Permesso Donazione</option>
                    <option value="elettorale">Permesso Elettorale</option>
                  </select>
                </div>

                {tipoRichiesta === 'permesso' && (
                  <div className="bg-white/40 p-4 rounded-2xl border border-green-150 space-y-4 animate-in fade-in duration-200">
                    <label className="block text-xs font-black text-green-950 uppercase tracking-wider">Frazionamento Permesso</label>
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
                      <div className="grid grid-cols-2 gap-4 pt-2 border-t border-green-100 animate-in slide-in-from-top-2 duration-200">
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

          {/* LISTA RICHIESTE */}
          <div className="bg-white/60 p-8 rounded-3xl border border-gray-100 shadow-inner">
             <h3 className="font-extrabold text-2xl mb-6 text-gray-900 flex items-center gap-2">
               {isHR ? "Richieste da Gestire" : "Le tue richieste"}
               {isHR && pendingCount > 0 && (
                 <span className="bg-red-500 text-white text-xs font-extrabold px-2 py-0.5 rounded-full">
                   {pendingCount}
                 </span>
               )}
             </h3>
            
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {listRichieste.length === 0 ? (
                <p className="text-center text-gray-400 py-10 font-medium">Nessuna richiesta presente.</p>
              ) : (
                listRichieste.map(req => (
                  <div key={req.id} className="p-4 sm:p-5 border border-gray-100 rounded-2xl bg-white shadow-sm hover:shadow-md transition-shadow flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 group">
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="font-bold text-base sm:text-lg text-gray-900 truncate">{req.dipendenteName}</div>
                      <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                        <span className="text-xs sm:text-sm font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">
                          {req.tipo === 'permesso' && req.oraInizio && req.oraFine
                            ? `Il ${formatDate(req.dataInizio || req.data)} dalle ${req.oraInizio} alle ${req.oraFine}`
                            : req.dataInizio && req.dataFine && req.dataInizio !== req.dataFine 
                              ? `Dal ${formatDate(req.dataInizio)} al ${formatDate(req.dataFine)}` 
                              : `Il ${formatDate(req.dataInizio || req.data)}`}
                        </span>
                        {getTipoLabel(req.tipo)}
                      </div>
                    </div>
                    
                    <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-3">
                      {getStatusBadge(req.stato)}
                      
                      {isHR && req.stato === 'In attesa' && (
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleDecision(req.id, true)} 
                            className="px-3 py-1.5 text-xs font-bold bg-green-500 text-white rounded-lg hover:bg-green-600 transition shadow-sm active:scale-95"
                          >
                            Approva
                          </button>
                          <button 
                            onClick={() => handleDecision(req.id, false)} 
                            className="px-3 py-1.5 text-xs font-bold bg-red-500 text-white rounded-lg hover:bg-red-600 transition shadow-sm active:scale-95"
                          >
                            Rifiuta
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
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
                      const isChiusura = isInChiusuraAziendaleLocal(dateStr);
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

                              titleStr += `\nStato: ${req.stato}\nTipo: ${getTipoData(req.tipo, req.frazioneTipo).label}`;
                              if (req.tipo === 'permesso' && req.oraInizio && req.oraFine && req.frazioneTipo !== 'mattina' && req.frazioneTipo !== 'pomeriggio' && req.frazioneTipo !== 'giornata') {
                                titleStr += `\nOrario: dalle ${req.oraInizio} alle ${req.oraFine}`;
                              }
                              if (req.note) titleStr += `\nNote: ${req.note}`;

                              if (isRejected) {
                                cellBg = 'bg-red-50 border-red-200 text-red-800/60 line-through opacity-50';
                              } else if (req.tipo === 'ferie') {
                                cellBg = isApproved 
                                  ? 'bg-sky-500 hover:bg-sky-600 border-sky-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                              } else if (['malattia', 'maternita'].includes(req.tipo)) {
                                cellBg = isApproved 
                                  ? 'bg-red-500 hover:bg-red-600 border-red-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = 'M';
                              } else if (req.tipo === 'smart') {
                                cellBg = isApproved 
                                  ? 'bg-emerald-500 hover:bg-emerald-600 border-emerald-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                              } else if (['mattina', 'pomeriggio', 'permesso'].includes(req.tipo)) {
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
                                  const hrs = Math.round((diffMs / 3600000) * 100) / 100;
                                  cellText = `${hrs.toString().replace('.', ',')}h`;
                                } else {
                                  cellText = 'P';
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
                <span className="w-6 h-4 rounded border border-sky-600 bg-sky-500"></span> Ferie
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-6 h-4 rounded border border-red-600 bg-red-500 flex items-center justify-center text-[10px] font-black text-white">M</span> Malattia/Maternità
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-6 h-4 rounded border border-amber-500 bg-amber-400"></span> Permesso (AM: Mattina - PM: Pomeriggio - GI: Giornata Intera)
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
                      else if (cancellationRequest.oraInizio && cancellationRequest.oraFine) cancelPeriod += ` dalle ${cancellationRequest.oraInizio} alle ${cancellationRequest.oraFine}`;
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
