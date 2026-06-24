import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { 
  collection, 
  onSnapshot, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  setDoc,
  query,
  where
} from 'firebase/firestore';
import { 
  Laptop, 
  Car, 
  CalendarDays, 
  Plus, 
  Trash2, 
  Check, 
  X, 
  RefreshCw, 
  Info, 
  Clock, 
  History, 
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Filter
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';

export interface Resource {
  id: string;
  nome: string;
  tipo: 'pc' | 'room' | 'car';
  docId?: string;
  dettagli: {
    utenteIngegno?: string;
    pswUtente?: string;
    licenzaAutodesk?: string;
    programmiInstallati?: string;
    ipAddress?: string;
    sede?: string;
    modello?: string;
    targa?: string;
  };
  statoCorrente?: {
    occupato: boolean;
    utilizzatoreNome: string | null;
    utilizzatoreEmail: string | null;
    dataInizioUso: string | null;
    revitInUso: boolean;
    autocadInUso: boolean;
  };
}

interface Booking {
  id: string;
  risorsaId: string;
  tipoRisorsa: 'room' | 'car';
  dipendenteNome: string;
  dipendenteEmail: string;
  dataInizio: string; // ISO string
  dataFine: string; // ISO string
  note: string;
  // Car specific fields
  kmPresaInCarico?: number | null;
  kmFineUtilizzo?: number | null;
  orarioEffettivoInizio?: string | null;
  orarioEffettivoFine?: string | null;
  statoUso?: 'prenotato' | 'in_corso' | 'concluso';
}

export default function Prenotazioni() {
  const { user, isAdmin, myAssociatedName } = useAuth();
  const currentUserName = myAssociatedName || user?.email || 'Dipendente';
  const currentUserEmail = user?.email || '';

  // Tabs: 'pc' | 'room' | 'car' | 'admin'
  const [activeTab, setActiveTab] = useState<'pc' | 'room' | 'car' | 'admin'>('pc');

  // Filtro postazioni libere
  const [showOnlyFree, setShowOnlyFree] = useState(false);

  // Firestore lists
  const [resources, setResources] = useState<Resource[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  // Toast notification state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Modals state
  const [isClaimPCModalOpen, setIsClaimPCModalOpen] = useState(false);
  const [selectedPC, setSelectedPC] = useState<Resource | null>(null);
  const [useRevit, setUseRevit] = useState(false);
  const [useAutoCAD, setUseAutoCAD] = useState(false);
  const [isEditPCModalOpen, setIsEditPCModalOpen] = useState(false);

  const [roomBookingData, setRoomBookingData] = useState({
    roomId: '',
    date: new Date().toLocaleDateString('sv-SE'), // YYYY-MM-DD
    startTime: '09:00',
    endTime: '10:00',
    note: ''
  });

  const [carBookingData, setCarBookingData] = useState({
    carId: '',
    startDate: new Date().toLocaleDateString('sv-SE'),
    endDate: new Date().toLocaleDateString('sv-SE'),
    note: ''
  });

  // License Limits state
  const [licenseLimits, setLicenseLimits] = useState({
    revitTotali: 6,
    autocadCompletoTotali: 6,
    autocadLtTotali: 7
  });
  const [revitInput, setRevitInput] = useState<number>(6);
  const [autocadCompletoInput, setAutocadCompletoInput] = useState<number>(6);
  const [autocadLtInput, setAutocadLtInput] = useState<number>(7);

  const [isCarCheckInModalOpen, setIsCarCheckInModalOpen] = useState(false);
  const [isCarCheckOutModalOpen, setIsCarCheckOutModalOpen] = useState(false);
  const [selectedCarBooking, setSelectedCarBooking] = useState<Booking | null>(null);
  const [carKmInput, setCarKmInput] = useState<number | ''>('');
  const [carDestInput, setCarDestInput] = useState('');

  // State per calendario Sale Riunioni
  const [currentMonthRoom, setCurrentMonthRoom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  // State per calendario Auto Aziendali
  const [currentMonthCar, setCurrentMonthCar] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  const shiftMonthRoom = (delta: number) => {
    const d = new Date(currentMonthRoom);
    d.setMonth(d.getMonth() + delta);
    setCurrentMonthRoom(d);
  };

  const daysInMonthRoom = new Date(currentMonthRoom.getFullYear(), currentMonthRoom.getMonth() + 1, 0).getDate();
  const firstDayIndexRoom = (new Date(currentMonthRoom.getFullYear(), currentMonthRoom.getMonth(), 1).getDay() + 6) % 7;
  const monthNameRoom = currentMonthRoom.toLocaleString('it-IT', { month: 'long', year: 'numeric' });

  const shiftMonthCar = (delta: number) => {
    const d = new Date(currentMonthCar);
    d.setMonth(d.getMonth() + delta);
    setCurrentMonthCar(d);
  };

  const daysInMonthCar = new Date(currentMonthCar.getFullYear(), currentMonthCar.getMonth() + 1, 0).getDate();
  const firstDayIndexCar = (new Date(currentMonthCar.getFullYear(), currentMonthCar.getMonth(), 1).getDay() + 6) % 7;
  const monthNameCar = currentMonthCar.toLocaleString('it-IT', { month: 'long', year: 'numeric' });

  const getRoomCalendarCells = () => {
    const cells = [];
    for (let i = 0; i < firstDayIndexRoom; i++) {
      cells.push(<div key={`empty-room-${i}`} className="min-h-[100px] bg-gray-50/50 rounded-xl border border-transparent"></div>);
    }
    for (let day = 1; day <= daysInMonthRoom; day++) {
      const dateStr = `${currentMonthRoom.getFullYear()}-${String(currentMonthRoom.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayBookings = bookings.filter(b => b.tipoRisorsa === 'room' && b.dataInizio.substring(0, 10) === dateStr);
      const sortedDayBookings = dayBookings.sort((a, b) => a.dataInizio.localeCompare(b.dataInizio));
      
      cells.push(
        <div key={`room-day-${day}`} className="min-h-[100px] bg-white rounded-xl border border-gray-200 p-2 shadow-sm hover:shadow-md transition-shadow flex flex-col">
          <div className="font-bold text-gray-700 mb-1 text-right">{day}</div>
          <div className="flex-1 flex flex-col gap-1 overflow-y-auto custom-scrollbar pr-1">
            {sortedDayBookings.map(b => {
              const room = resources.find(r => r.id === b.risorsaId);
              const roomName = room ? room.nome : b.risorsaId;
              const startH = b.dataInizio.split('T')[1].substring(0, 5);
              const endH = b.dataFine.split('T')[1].substring(0, 5);
              const isMe = b.dipendenteEmail?.toLowerCase() === currentUserEmail?.toLowerCase();
              const canCancel = isMe || isAdmin;
              return (
                <div 
                  key={b.id}
                  onClick={() => canCancel && handleCancelBooking(b)}
                  className={`text-[10px] p-1.5 rounded border bg-indigo-50 border-indigo-200 text-indigo-800 flex flex-col gap-0.5 font-medium leading-tight shadow-sm ${
                    canCancel ? 'cursor-pointer hover:bg-red-50 hover:border-red-200 hover:text-red-800 transition-colors' : ''
                  }`}
                  title={canCancel ? "Clicca per cancellare questa prenotazione" : undefined}
                >
                  <div className="font-extrabold flex justify-between items-center gap-1">
                    <span className="truncate">{roomName}</span>
                    <span className="text-[9px] text-indigo-600 bg-indigo-100/80 px-1 rounded-sm shrink-0">{startH}-{endH}</span>
                  </div>
                  <div className="truncate text-gray-750 font-bold">{b.dipendenteNome}</div>
                  {b.note && <div className="text-[9px] text-gray-500 italic truncate">"{b.note}"</div>}
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return cells;
  };

  const getCarCalendarCells = () => {
    const cells = [];
    for (let i = 0; i < firstDayIndexCar; i++) {
      cells.push(<div key={`empty-car-${i}`} className="min-h-[100px] bg-gray-50/50 rounded-xl border border-transparent"></div>);
    }
    for (let day = 1; day <= daysInMonthCar; day++) {
      const dateStr = `${currentMonthCar.getFullYear()}-${String(currentMonthCar.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayBookings = bookings.filter(b => b.tipoRisorsa === 'car' && b.dataInizio.substring(0, 10) <= dateStr && b.dataFine.substring(0, 10) >= dateStr);
      const sortedDayBookings = dayBookings.sort((a, b) => a.dataInizio.localeCompare(b.dataInizio));
      
      cells.push(
        <div key={`car-day-${day}`} className="min-h-[100px] bg-white rounded-xl border border-gray-200 p-2 shadow-sm hover:shadow-md transition-shadow flex flex-col">
          <div className="font-bold text-gray-700 mb-1 text-right">{day}</div>
          <div className="flex-1 flex flex-col gap-1 overflow-y-auto custom-scrollbar pr-1">
            {sortedDayBookings.map(b => {
              const car = resources.find(r => r.id === b.risorsaId);
              const carName = car ? car.nome : b.risorsaId;
              const isMe = b.dipendenteEmail?.toLowerCase() === currentUserEmail?.toLowerCase();
              const canCancel = (isMe || isAdmin) && b.statoUso !== 'concluso';
              
              let bg = 'bg-teal-50 border-teal-200 text-teal-800';
              let dotBg = 'bg-teal-400';
              if (b.statoUso === 'concluso') {
                bg = 'bg-gray-100 border-gray-200 text-gray-650 opacity-60';
                dotBg = 'bg-gray-400';
              } else if (b.statoUso === 'in_corso') {
                bg = 'bg-amber-50 border-amber-200 text-amber-800';
                dotBg = 'bg-amber-400';
              }

              return (
                <div 
                  key={b.id}
                  onClick={() => canCancel && handleCancelBooking(b)}
                  className={`text-[10px] p-1.5 rounded border ${bg} flex flex-col gap-0.5 font-medium leading-tight shadow-sm ${
                    canCancel ? 'cursor-pointer hover:bg-red-50 hover:border-red-200 hover:text-red-800 transition-colors' : ''
                  }`}
                  title={canCancel ? "Clicca per cancellare questa prenotazione" : undefined}
                >
                  <div className="font-extrabold flex justify-between items-center gap-1">
                    <span className="truncate">{carName}</span>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotBg}`}></span>
                  </div>
                  <div className="truncate text-gray-750 font-bold">{b.dipendenteNome}</div>
                  {b.note && <div className="text-[9px] text-gray-500 italic truncate">"{b.note}"</div>}
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return cells;
  };

  // Admin Modals
  const [isAdminAddResourceOpen, setIsAdminAddResourceOpen] = useState(false);
  const [newResourceData, setNewResourceData] = useState({
    id: '',
    nome: '',
    tipo: 'pc' as 'pc' | 'room' | 'car',
    utenteIngegno: '',
    pswUtente: '',
    licenzaAutodesk: 'AEC Collection',
    programmiInstallati: '',
    ipAddress: '',
    sede: 'Via Diaz',
    modello: '',
    targa: ''
  });

  // Confirmation modal config
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmConfig({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // Real-time Firestore subscriptions
  useEffect(() => {
    setLoading(true);
    // 1. Listen for resources
    const unsubResources = onSnapshot(collection(db, 'risorse'), (snapshot) => {
      const resList: Resource[] = snapshot.docs.map(docSnap => ({
        docId: docSnap.id,
        ...docSnap.data()
      } as unknown as Resource));
      setResources(resList);
    }, (err) => {
      console.error("Error loading resources:", err);
      showToast("Errore nel caricamento delle risorse.", "error");
    });

    // 2. Listen for bookings (last 60 days to prevent infinite data load)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const limitDate = sixtyDaysAgo.toLocaleDateString('sv-SE');

    const bookingsQuery = query(
      collection(db, 'prenotazioni_risorse'),
      where('dataFine', '>=', limitDate)
    );

    const unsubBookings = onSnapshot(bookingsQuery, (snapshot) => {
      const bookList: Booking[] = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      } as Booking));
      setBookings(bookList);
      setLoading(false);
    }, (err) => {
      console.error("Error loading bookings:", err);
      showToast("Errore nel caricamento delle prenotazioni.", "error");
    });

    // 3. Listen for license limits
    const unsubLimits = onSnapshot(doc(db, 'configurazioni', 'licenze'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const revit = Number(data.revitTotali) || 6;
        const autocadCompleto = Number(data.autocadCompletoTotali) || Number(data.autocadTotali) || 6;
        const autocadLt = Number(data.autocadLtTotali) || 7;
        setLicenseLimits({ 
          revitTotali: revit, 
          autocadCompletoTotali: autocadCompleto, 
          autocadLtTotali: autocadLt 
        });
        setRevitInput(revit);
        setAutocadCompletoInput(autocadCompleto);
        setAutocadLtInput(autocadLt);
      }
    }, (err) => {
      console.error("Error loading license limits:", err);
    });

    return () => {
      unsubResources();
      unsubBookings();
      unsubLimits();
    };
  }, []);

  // Filtered lists of resources
  const pcsList = useMemo(() => resources.filter(r => r.tipo === 'pc').sort((a, b) => a.id.localeCompare(b.id)), [resources]);

  const getTwinStatus = (pc: Resource) => {
    const user = pc.dettagli.utenteIngegno?.trim().toLowerCase();
    if (!user || user === 'nessuna' || pc.dettagli.licenzaAutodesk === 'Autocad LT') {
      return {
        hasTwins: false,
        twins: [],
        isTwinRevitInUse: false,
        isTwinAutocadInUse: false,
        areAllTwinLicensesInUse: false
      };
    }

    const twins = pcsList.filter(other => 
      other.id !== pc.id && 
      other.dettagli.utenteIngegno?.trim().toLowerCase() === user
    );

    const isTwinRevitInUse = twins.some(t => t.statoCorrente?.occupato && t.statoCorrente?.revitInUso);
    const isTwinAutocadInUse = twins.some(t => t.statoCorrente?.occupato && t.statoCorrente?.autocadInUso);

    return {
      hasTwins: twins.length > 0,
      twins,
      isTwinRevitInUse,
      isTwinAutocadInUse,
      areAllTwinLicensesInUse: isTwinRevitInUse && isTwinAutocadInUse
    };
  };

  const filteredPcsList = useMemo(() => {
    if (!showOnlyFree) return pcsList;
    return pcsList.filter(pc => {
      const isOccupied = pc.statoCorrente?.occupato;
      if (isOccupied) return false;
      const twinStatus = getTwinStatus(pc);
      const isDisabled = twinStatus.areAllTwinLicensesInUse;
      return !isDisabled;
    });
  }, [pcsList, showOnlyFree]);

  const aecGroups = useMemo(() => {
    const groups: Record<string, Resource[]> = {};
    const ltPcs: Resource[] = [];
    const otherPcs: Resource[] = [];

    filteredPcsList.forEach(pc => {
      if (pc.dettagli.licenzaAutodesk === 'Autocad LT') {
        ltPcs.push(pc);
      } else {
        const user = pc.dettagli.utenteIngegno?.trim().toLowerCase() || '';
        if (user && user !== 'nessuna') {
          if (!groups[user]) {
            groups[user] = [];
          }
          groups[user].push(pc);
        } else {
          otherPcs.push(pc);
        }
      }
    });

    // Sort AutoCAD LT PCs by utenteIngegno (e.g. disegnatore07, disegnatore08...) to match excel
    ltPcs.sort((a, b) => {
      const userA = a.dettagli.utenteIngegno?.trim().toLowerCase() || '';
      const userB = b.dettagli.utenteIngegno?.trim().toLowerCase() || '';
      return userA.localeCompare(userB);
    });

    return { groups, ltPcs, otherPcs };
  }, [filteredPcsList]);
  const roomsList = useMemo(() => resources.filter(r => r.tipo === 'room').sort((a, b) => a.nome.localeCompare(b.nome)), [resources]);
  const carsList = useMemo(() => resources.filter(r => r.tipo === 'car').sort((a, b) => a.nome.localeCompare(b.nome)), [resources]);

  // Compute CAD PCs stats
  const pcStats = useMemo(() => {
    const total = pcsList.length;
    const occupied = pcsList.filter(pc => pc.statoCorrente?.occupato).length;
    const revitCount = pcsList.filter(pc => pc.statoCorrente?.occupato && pc.statoCorrente?.revitInUso).length;
    const autocadCompletoCount = pcsList.filter(pc => 
      pc.statoCorrente?.occupato && 
      pc.statoCorrente?.autocadInUso && 
      pc.dettagli.licenzaAutodesk === 'AEC Collection'
    ).length;
    const autocadLtCount = pcsList.filter(pc => 
      pc.statoCorrente?.occupato && 
      pc.statoCorrente?.autocadInUso && 
      pc.dettagli.licenzaAutodesk === 'Autocad LT'
    ).length;
    return { 
      total, 
      occupied, 
      available: total - occupied, 
      revitCount, 
      autocadCompletoCount, 
      autocadLtCount 
    };
  }, [pcsList]);

  // Save License Limits
  const handleSaveLicenseLimits = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, 'configurazioni', 'licenze'), {
        revitTotali: Number(revitInput),
        autocadCompletoTotali: Number(autocadCompletoInput),
        autocadLtTotali: Number(autocadLtInput)
      });
      showToast("Limiti licenze aggiornati con successo!");
    } catch (err: any) {
      console.error("Error saving limits:", err);
      showToast("Errore nel salvataggio limiti: " + err.message, "error");
    }
  };

  // PC: Claim workstation
  const handleClaimPCSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPC) return;

    const twinStatus = getTwinStatus(selectedPC);
    if (useRevit && twinStatus.isTwinRevitInUse) {
      showToast("La licenza Revit è già in uso sul PC gemello!", "error");
      return;
    }
    if (useAutoCAD && twinStatus.isTwinAutocadInUse) {
      showToast("La licenza AutoCAD è già in uso sul PC gemello!", "error");
      return;
    }

    const docId = `pc_${selectedPC.id.toLowerCase()}`;
    try {
      await updateDoc(doc(db, 'risorse', docId), {
        'statoCorrente.occupato': true,
        'statoCorrente.utilizzatoreNome': currentUserName,
        'statoCorrente.utilizzatoreEmail': currentUserEmail,
        'statoCorrente.dataInizioUso': new Date().toISOString(),
        'statoCorrente.revitInUso': useRevit,
        'statoCorrente.autocadInUso': useAutoCAD
      });
      showToast(`PC ${selectedPC.id} preso in carico!`);
      setIsClaimPCModalOpen(false);
      setSelectedPC(null);
    } catch (err: any) {
      console.error(err);
      showToast("Errore nella presa in carico: " + err.message, "error");
    }
  };

  // PC: Edit active licenses for workstation
  const handleEditPCSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPC) return;

    const twinStatus = getTwinStatus(selectedPC);
    if (useRevit && twinStatus.isTwinRevitInUse) {
      showToast("La licenza Revit è già in uso sul PC gemello!", "error");
      return;
    }
    if (useAutoCAD && twinStatus.isTwinAutocadInUse) {
      showToast("La licenza AutoCAD è già in uso sul PC gemello!", "error");
      return;
    }

    const docId = `pc_${selectedPC.id.toLowerCase()}`;
    try {
      await updateDoc(doc(db, 'risorse', docId), {
        'statoCorrente.revitInUso': useRevit,
        'statoCorrente.autocadInUso': useAutoCAD
      });
      showToast(`Licenze per PC ${selectedPC.id} aggiornate!`);
      setIsEditPCModalOpen(false);
      setSelectedPC(null);
    } catch (err: any) {
      console.error(err);
      showToast("Errore nell'aggiornamento licenze: " + err.message, "error");
    }
  };

  // PC: Release workstation
  const handleReleasePC = async (pc: Resource, forced = false) => {
    const docId = `pc_${pc.id.toLowerCase()}`;
    const action = () => {
      triggerConfirm(
        forced ? "Forza Rilascio PC" : "Rilascia PC",
        forced 
          ? `Sei sicuro di voler forzare il rilascio di ${pc.id} attualmente in uso da ${pc.statoCorrente?.utilizzatoreNome}?`
          : `Vuoi rilasciare il PC ${pc.id} e renderlo disponibile?`,
        async () => {
          try {
            await updateDoc(doc(db, 'risorse', docId), {
              'statoCorrente.occupato': false,
              'statoCorrente.utilizzatoreNome': null,
              'statoCorrente.utilizzatoreEmail': null,
              'statoCorrente.dataInizioUso': null,
              'statoCorrente.revitInUso': false,
              'statoCorrente.autocadInUso': false
            });
            showToast(forced ? `Rilascio forzato per PC ${pc.id} completato.` : `PC ${pc.id} rilasciato.`);
          } catch (err: any) {
            console.error(err);
            showToast("Errore nel rilascio: " + err.message, "error");
          }
        }
      );
    };
    action();
  };

  // Rooms: Conflict Check
  const checkRoomConflict = (roomId: string, date: string, start: string, end: string): Booking | null => {
    const requestedStart = `${date}T${start}:00`;
    const requestedEnd = `${date}T${end}:00`;

    for (const b of bookings) {
      if (b.tipoRisorsa === 'room' && b.risorsaId === roomId) {
        // Bookings on the same date
        const bStart = b.dataInizio;
        const bFine = b.dataFine;
        
        // Overlap check: start1 < end2 AND start2 < end1
        if (requestedStart < bFine && bStart < requestedEnd) {
          return b; // returns conflicting booking
        }
      }
    }
    return null;
  };

  // Rooms: Book
  const handleBookRoomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { roomId, date, startTime, endTime, note } = roomBookingData;
    if (!roomId) {
      showToast("Seleziona una sala.", "warning");
      return;
    }
    if (startTime >= endTime) {
      showToast("L'ora di inizio deve essere prima dell'ora di fine.", "warning");
      return;
    }

    const conflict = checkRoomConflict(roomId, date, startTime, endTime);
    if (conflict) {
      showToast(`Conflitto! La sala è già prenotata da ${conflict.dipendenteNome} dalle ${conflict.dataInizio.split('T')[1].substring(0, 5)} alle ${conflict.dataFine.split('T')[1].substring(0, 5)}.`, "error");
      return;
    }

    try {
      await addDoc(collection(db, 'prenotazioni_risorse'), {
        risorsaId: roomId,
        tipoRisorsa: 'room',
        dipendenteNome: currentUserName,
        dipendenteEmail: currentUserEmail,
        dataInizio: `${date}T${startTime}:00`,
        dataFine: `${date}T${endTime}:00`,
        note: note.trim()
      });
      showToast("Sala prenotata con successo!");
      setRoomBookingData(prev => ({ ...prev, note: '' }));
    } catch (err: any) {
      console.error(err);
      showToast("Errore nella prenotazione: " + err.message, "error");
    }
  };

  // Cars: Conflict Check
  const checkCarConflict = (carId: string, startD: string, endD: string): Booking | null => {
    // Range comparison on dates
    for (const b of bookings) {
      if (b.tipoRisorsa === 'car' && b.risorsaId === carId && b.statoUso !== 'concluso') {
        const bStart = b.dataInizio.substring(0, 10);
        const bFine = b.dataFine.substring(0, 10);
        
        // Overlap checks
        if (startD <= bFine && bStart <= endD) {
          return b;
        }
      }
    }
    return null;
  };

  // Cars: Book
  const handleBookCarSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { carId, startDate, endDate, note } = carBookingData;
    if (!carId) {
      showToast("Seleziona un'auto.", "warning");
      return;
    }
    if (startDate > endDate) {
      showToast("La data inizio deve essere precedente o uguale alla data fine.", "warning");
      return;
    }

    const conflict = checkCarConflict(carId, startDate, endDate);
    if (conflict) {
      showToast(`L'auto è già prenotata da ${conflict.dipendenteNome} dal ${conflict.dataInizio.substring(0, 10)} al ${conflict.dataFine.substring(0, 10)}.`, "error");
      return;
    }

    try {
      await addDoc(collection(db, 'prenotazioni_risorse'), {
        risorsaId: carId,
        tipoRisorsa: 'car',
        dipendenteNome: currentUserName,
        dipendenteEmail: currentUserEmail,
        dataInizio: `${startDate}T00:00:00`,
        dataFine: `${endDate}T23:59:59`,
        note: note.trim(),
        statoUso: 'prenotato',
        kmPresaInCarico: null,
        kmFineUtilizzo: null,
        orarioEffettivoInizio: null,
        orarioEffettivoFine: null
      });
      showToast("Auto prenotata con successo!");
      setCarBookingData(prev => ({ ...prev, note: '' }));
    } catch (err: any) {
      console.error(err);
      showToast("Errore nella prenotazione: " + err.message, "error");
    }
  };

  // Delete Booking (Rooms & Cars)
  const handleCancelBooking = (booking: Booking) => {
    triggerConfirm(
      "Cancella Prenotazione",
      `Sei sicuro di voler cancellare la prenotazione per ${booking.tipoRisorsa === 'room' ? 'la sala' : "l'auto"} effettuata da ${booking.dipendenteNome}?`,
      async () => {
        try {
          await deleteDoc(doc(db, 'prenotazioni_risorse', booking.id));
          showToast("Prenotazione cancellata.");
        } catch (err: any) {
          console.error(err);
          showToast("Errore nella cancellazione: " + err.message, "error");
        }
      }
    );
  };

  // Cars: Check-in (presa in carico)
  const handleCarCheckInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCarBooking || carKmInput === '') return;

    try {
      await updateDoc(doc(db, 'prenotazioni_risorse', selectedCarBooking.id), {
        statoUso: 'in_corso',
        kmPresaInCarico: Number(carKmInput),
        orarioEffettivoInizio: new Date().toISOString()
      });
      showToast("Auto presa in consegna! Buon viaggio.");
      setIsCarCheckInModalOpen(false);
      setSelectedCarBooking(null);
      setCarKmInput('');
    } catch (err: any) {
      console.error(err);
      showToast("Errore durante il check-in: " + err.message, "error");
    }
  };

  // Cars: Check-out (restituzione)
  const handleCarCheckOutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCarBooking || carKmInput === '') return;

    const kmInizio = selectedCarBooking.kmPresaInCarico || 0;
    if (Number(carKmInput) < kmInizio) {
      showToast(`I km finali (${carKmInput}) non possono essere inferiori a quelli iniziali (${kmInizio}).`, "warning");
      return;
    }

    try {
      await updateDoc(doc(db, 'prenotazioni_risorse', selectedCarBooking.id), {
        statoUso: 'concluso',
        kmFineUtilizzo: Number(carKmInput),
        orarioEffettivoFine: new Date().toISOString(),
        note: carDestInput.trim() || selectedCarBooking.note
      });
      showToast("Auto restituita. Viaggio registrato nel registro storico.");
      setIsCarCheckOutModalOpen(false);
      setSelectedCarBooking(null);
      setCarKmInput('');
      setCarDestInput('');
    } catch (err: any) {
      console.error(err);
      showToast("Errore durante il check-out: " + err.message, "error");
    }
  };

  // Admin: Add new Resource
  const handleAddResourceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { id, nome, tipo, utenteIngegno, pswUtente, licenzaAutodesk, programmiInstallati, ipAddress, sede, modello, targa } = newResourceData;
    if (!id.trim() || !nome.trim()) {
      showToast("Identificativo e Nome sono richiesti.", "warning");
      return;
    }

    const docId = `${tipo}_${id.toLowerCase().trim()}`;
    const cleanId = id.trim();
    const cleanNome = nome.trim();

    let details: any = {};
    let statoCorrente: any = null;

    if (tipo === 'pc') {
      details = {
        utenteIngegno: utenteIngegno.trim(),
        pswUtente: pswUtente.trim(),
        licenzaAutodesk: licenzaAutodesk.trim(),
        programmiInstallati: programmiInstallati.trim(),
        ipAddress: ipAddress.trim()
      };
      statoCorrente = {
        occupato: false,
        utilizzatoreNome: null,
        utilizzatoreEmail: null,
        dataInizioUso: null,
        revitInUso: false,
        autocadInUso: false
      };
    } else if (tipo === 'room') {
      details = {
        sede: sede.trim()
      };
    } else if (tipo === 'car') {
      details = {
        modello: modello.trim(),
        targa: targa.toUpperCase().trim(),
        sede: sede.trim()
      };
    }

    const newResPayload: any = {
      id: cleanId,
      nome: cleanNome,
      tipo,
      dettagli: details
    };
    if (statoCorrente) {
      newResPayload.statoCorrente = statoCorrente;
    }

    try {
      await setDoc(doc(db, 'risorse', docId), newResPayload);
      showToast(`Risorsa "${cleanNome}" aggiunta con successo.`);
      setIsAdminAddResourceOpen(false);
      setNewResourceData({
        id: '',
        nome: '',
        tipo: 'pc',
        utenteIngegno: '',
        pswUtente: '',
        licenzaAutodesk: 'AEC Collection',
        programmiInstallati: '',
        ipAddress: '',
        sede: 'Via Diaz',
        modello: '',
        targa: ''
      });
    } catch (err: any) {
      console.error(err);
      showToast("Errore nel salvataggio: " + err.message, "error");
    }
  };

  // Admin: Delete resource
  const handleDeleteResource = (res: Resource) => {
    const docId = `${res.tipo}_${res.id.toLowerCase()}`;
    triggerConfirm(
      "Elimina Risorsa",
      `Sei sicuro di voler eliminare definitivamente la risorsa "${res.nome}"? Nota: eventuali prenotazioni esistenti per questa risorsa non verranno cancellate ma non avranno più una risorsa associata.`,
      async () => {
        try {
          await deleteDoc(doc(db, 'risorse', docId));
          showToast(`Risorsa "${res.nome}" eliminata.`);
        } catch (err: any) {
          console.error(err);
          showToast("Errore nell'eliminazione: " + err.message, "error");
        }
      }
    );
  };

  // Format Helper for dates
  const formatDateTime = (isoStr: string | null | undefined) => {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoStr;
    }
  };

  // Group room bookings by date
  const roomBookingsSorted = useMemo(() => {
    return bookings
      .filter(b => b.tipoRisorsa === 'room' && b.dataInizio >= new Date().toLocaleDateString('sv-SE'))
      .sort((a, b) => a.dataInizio.localeCompare(b.dataInizio));
  }, [bookings]);

  // Active car bookings for user (today)
  const activeCarBookingsForUser = useMemo(() => {
    const todayStr = new Date().toLocaleDateString('sv-SE');
    return bookings.filter(b => 
      b.tipoRisorsa === 'car' && 
      b.dipendenteEmail?.toLowerCase() === currentUserEmail?.toLowerCase() &&
      b.dataInizio.substring(0, 10) <= todayStr && 
      b.dataFine.substring(0, 10) >= todayStr &&
      b.statoUso !== 'concluso'
    );
  }, [bookings, currentUserEmail]);

  // Car bookings schedule (future or in corso)
  const carBookingsSorted = useMemo(() => {
    return bookings
      .filter(b => b.tipoRisorsa === 'car' && b.statoUso !== 'concluso')
      .sort((a, b) => a.dataInizio.localeCompare(b.dataInizio));
  }, [bookings]);

  // Car usage log history (concluded)
  const carHistoryLogs = useMemo(() => {
    return bookings
      .filter(b => b.tipoRisorsa === 'car' && b.statoUso === 'concluso')
      .sort((a, b) => (b.orarioEffettivoFine || b.dataFine).localeCompare(a.orarioEffettivoFine || a.dataInizio));
  }, [bookings]);

  const renderPcCard = (pc: Resource) => {
    const isOccupied = pc.statoCorrente?.occupato;
    const isMe = pc.statoCorrente?.utilizzatoreEmail?.toLowerCase() === currentUserEmail?.toLowerCase();
    
    const twinStatus = getTwinStatus(pc);
    const isTwinRevitInUse = twinStatus.isTwinRevitInUse;
    const isTwinAutocadInUse = twinStatus.isTwinAutocadInUse;
    const areAllTwinLicensesInUse = twinStatus.areAllTwinLicensesInUse;
    
    // A PC is disabled if it's NOT occupied AND its twin has consumed both licenses
    const isDisabled = !isOccupied && areAllTwinLicensesInUse;

    return (
      <div 
        key={pc.id} 
        className={`grid grid-cols-1 lg:grid-cols-12 items-start lg:items-center py-3.5 px-5 rounded-2xl border transition-all gap-4 lg:gap-6 text-sm ${
          isOccupied 
            ? isMe
              ? 'bg-indigo-50/40 border-indigo-200 border-l-4 border-l-indigo-600 shadow-sm'
              : 'bg-rose-50/50 border-rose-200 border-l-4 border-l-rose-500 shadow-sm' 
            : isDisabled
              ? 'bg-gray-50/70 border-gray-250 border-l-4 border-l-gray-300 opacity-60 shadow-none select-none'
              : 'bg-white border-gray-100 border-l-4 border-l-emerald-500 hover:border-gray-250 hover:shadow-sm'
        }`}
      >
        {/* Column 1: Stato PC (col-span-1) */}
        <div className="lg:col-span-1 flex items-center justify-center">
          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider text-center block w-full ${
            isOccupied 
              ? isMe
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-rose-600 text-white shadow-sm'
              : isDisabled
                ? 'bg-gray-400 text-white shadow-sm'
                : 'bg-emerald-600 text-white shadow-sm'
          }`}>
            {isOccupied ? 'IN USO' : isDisabled ? 'DISATTIVO' : 'LIBERO'}
          </span>
        </div>

        {/* Column 2: Identificatore PC (col-span-1) */}
        <div className="lg:col-span-1 flex items-center gap-2 lg:justify-center">
          <Laptop className={`w-5 h-5 shrink-0 ${isMe ? 'text-indigo-600' : isOccupied ? 'text-rose-500' : isDisabled ? 'text-gray-400' : 'text-teal-600'}`} />
          <div>
            <h3 className={`font-black text-sm ${isDisabled ? 'text-gray-400' : 'text-gray-900'}`}>{pc.id}</h3>
            {pc.dettagli.sede && (
              <span className="text-[10px] text-gray-400 font-bold block mt-0.5 leading-none">{pc.dettagli.sede}</span>
            )}
          </div>
        </div>

        {/* Column 3: Dettagli di Collegamento (col-span-3) */}
        <div className="lg:col-span-3 flex flex-col gap-1 text-xs">
          <div className="font-mono text-gray-800 font-bold">
            IP: <span className="select-all bg-gray-100 px-1.5 py-0.5 rounded">{pc.dettagli.ipAddress || '-'}</span>
          </div>
          <div className="text-gray-555 font-semibold mt-0.5">
            <div>Utente e Password:</div>
            <div className="mt-1 flex items-center gap-1">
              <span className="bg-gray-100 px-1.5 py-0.5 rounded font-black text-gray-700">{pc.dettagli.utenteIngegno}</span> 
              <span className="text-gray-400">/</span> 
              <span className="bg-gray-100 px-1.5 py-0.5 rounded font-black text-gray-700 select-all">{pc.dettagli.pswUtente}</span>
            </div>
          </div>
        </div>

        {/* Column 4: Programmi Installati (col-span-3) */}
        <div className="lg:col-span-3 flex flex-col gap-0.5 text-xs">
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Programmi Installati:</span>
          <span className="font-bold text-gray-700 leading-tight">
            {pc.dettagli.programmiInstallati || 'Non specificati'}
          </span>
        </div>

        {/* Column 5: Utilizzatore / Vincoli licenza (col-span-2) */}
        <div className="lg:col-span-2 text-xs">
          {isOccupied ? (
            <div className="flex flex-col gap-1.5 justify-center">
              {isMe ? (
                <div className="font-extrabold uppercase text-[10px] text-indigo-900 tracking-tight leading-none">
                  In uso da: 
                  <span className="text-indigo-950 font-black block mt-0.5 flex items-center gap-1.5">
                    {pc.statoCorrente?.utilizzatoreNome}
                    <span className="bg-indigo-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider inline-block">Tu</span>
                  </span>
                </div>
              ) : (
                <div className="font-extrabold uppercase text-[10px] text-rose-900 tracking-tight leading-none">
                  In uso da: <span className="text-rose-950 font-black block mt-0.5">{pc.statoCorrente?.utilizzatoreNome}</span>
                </div>
              )}
              <div className="text-[10px] text-gray-450 font-semibold mt-0.5">Da: {formatDateTime(pc.statoCorrente?.dataInizioUso)}</div>
              <div className="flex flex-col gap-1 mt-1">
                {pc.statoCorrente?.revitInUso && (
                  <span className="bg-indigo-600 text-white text-[10px] font-black px-2 py-0.5 rounded shadow-sm text-center block w-full max-w-[130px] border border-indigo-700">
                    Licenza Revit
                  </span>
                )}
                {pc.statoCorrente?.autocadInUso && (
                  <span className="bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded shadow-sm text-center block w-full max-w-[130px] border border-blue-700">
                    {pc.dettagli.licenzaAutodesk === 'Autocad LT' ? 'Licenza Autocad LT' : 'Licenza Autocad'}
                  </span>
                )}
              </div>
            </div>
          ) : isDisabled ? (
            <div className="text-[10px] text-gray-500 font-bold bg-gray-100 p-1.5 rounded-lg border border-gray-200/50 inline-flex items-center gap-1">
              <span>⚠️ Licenze esaurite sul gemello</span>
            </div>
          ) : (
            <div className="font-bold text-gray-550 flex flex-col gap-0.5">
              <div>Licenza Base: <span className="text-gray-700 font-extrabold">{pc.dettagli.licenzaAutodesk === 'Autocad LT' ? 'Autocad LT' : 'AEC Collection'}</span></div>
              {twinStatus.hasTwins && (isTwinRevitInUse || isTwinAutocadInUse) && (
                <div className="text-amber-700 bg-amber-50/50 px-1.5 py-0.5 rounded border border-amber-100/50 leading-tight text-[9px] mt-0.5 font-bold">
                  {isTwinRevitInUse && <div>• Revit su gemello</div>}
                  {isTwinAutocadInUse && <div>• AutoCAD su gemello</div>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Column 6: Azioni (col-span-2) */}
        <div className="lg:col-span-2 flex items-center justify-end gap-1.5 w-full lg:w-auto">
          {!isOccupied ? (
            <button
              onClick={() => {
                if (isDisabled) return;
                setSelectedPC(pc);
                setUseRevit(false);
                setUseAutoCAD(false);
                setIsClaimPCModalOpen(true);
              }}
              disabled={isDisabled}
              className={`px-3.5 py-2 rounded-lg font-bold transition text-xs shadow active:scale-98 flex items-center gap-1 w-full lg:w-auto justify-center ${
                isDisabled 
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
                  : 'bg-teal-600 hover:bg-teal-700 text-white cursor-pointer'
              }`}
            >
              <Check className="w-3.5 h-3.5" /> Prendi in uso
            </button>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-1.5 w-full justify-end">
              {isMe && (
                <button
                  onClick={() => {
                    setSelectedPC(pc);
                    setUseRevit(pc.statoCorrente?.revitInUso || false);
                    setUseAutoCAD(pc.statoCorrente?.autocadInUso || false);
                    setIsEditPCModalOpen(true);
                  }}
                  className="w-full sm:w-auto px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition text-xs shadow flex items-center gap-1 shrink-0 justify-center"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Modifica
                </button>
              )}
              {isMe ? (
                <button
                  onClick={() => handleReleasePC(pc, false)}
                  className="w-full sm:w-auto px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg transition text-xs shadow active:scale-98 flex items-center gap-1 shrink-0 justify-center"
                >
                  <X className="w-3.5 h-3.5" /> Rilascia
                </button>
              ) : (
                isAdmin && (
                  <button
                    onClick={() => handleReleasePC(pc, true)}
                    className="w-full sm:w-auto px-3 py-2 border border-rose-200 text-rose-600 hover:bg-rose-50 font-bold rounded-lg transition text-xs active:scale-98 flex items-center shrink-0 justify-center"
                  >
                    Forza Rilascio
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-gray-500">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mb-3" />
        <span className="font-bold">Caricamento bacheca risorse in corso...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      
      {/* Intestazione */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm p-6 sm:p-8 border border-white/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Prenotazione & Gestione Risorse</h1>
          <p className="text-gray-500 font-bold text-sm mt-1">Sale Riunioni, Auto Aziendali e PC CAD condivisi.</p>
        </div>
        
        {/* Tab Selector */}
        <div className="flex bg-gray-100 p-1.5 rounded-2xl w-full sm:w-auto overflow-x-auto gap-1">
          <button 
            onClick={() => setActiveTab('pc')}
            className={`flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition-all ${
              activeTab === 'pc' ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Laptop className="w-4 h-4" /> PC CAD Remoti
          </button>
          <button 
            onClick={() => setActiveTab('room')}
            className={`flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition-all ${
              activeTab === 'room' ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <CalendarDays className="w-4 h-4" /> Sale Riunioni
          </button>
          <button 
            onClick={() => setActiveTab('car')}
            className={`flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition-all ${
              activeTab === 'car' ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Car className="w-4 h-4" /> Auto Aziendali
          </button>
          {isAdmin && (
            <button 
              onClick={() => setActiveTab('admin')}
              className={`flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition-all ${
                activeTab === 'admin' ? 'bg-white text-red-600 shadow-sm' : 'text-red-500 hover:text-red-700'
              }`}
            >
              <ShieldAlert className="w-4 h-4" /> Gestione
            </button>
          )}
        </div>
      </div>

      {/* --- TAB 1: POSTAZIONI CAD --- */}
      {activeTab === 'pc' && (
        <div className="space-y-6">
          {/* Dashboard Licenze / Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50 flex flex-col justify-between">
              <span className="text-xs font-extrabold text-gray-400 uppercase tracking-wider">Stato PC Remoti</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-4xl font-black text-gray-800">{pcStats.occupied}</span>
                <span className="text-gray-400 font-bold">/ {pcStats.total} in uso</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 mt-4 overflow-hidden">
                <div 
                  className="bg-teal-500 h-2 rounded-full transition-all duration-500" 
                  style={{ width: `${(pcStats.occupied / (pcStats.total || 1)) * 100}%` }}
                />
              </div>
              <span className="text-xs font-bold text-gray-500 mt-2">{pcStats.available} PC disponibili</span>
            </div>

            <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50 flex flex-col justify-between">
              <span className="text-xs font-extrabold text-indigo-400 uppercase tracking-wider">Licenze Revit</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-4xl font-black text-indigo-600">{pcStats.revitCount}</span>
                <span className="text-gray-400 font-bold">/ {licenseLimits.revitTotali} in uso</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 mt-4 overflow-hidden">
                <div 
                  className={`h-2 rounded-full transition-all duration-500 ${
                    pcStats.revitCount > licenseLimits.revitTotali ? 'bg-red-500 animate-pulse' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${Math.min((pcStats.revitCount / (licenseLimits.revitTotali || 1)) * 100, 100)}%` }}
                />
              </div>
              <span className="text-xs font-bold text-gray-500 mt-2">
                {pcStats.revitCount > licenseLimits.revitTotali 
                  ? "⚠️ Limite superato!" 
                  : `${Math.max(licenseLimits.revitTotali - pcStats.revitCount, 0)} libere`}
              </span>
            </div>

            <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50 flex flex-col justify-between">
              <span className="text-xs font-extrabold text-blue-500 uppercase tracking-wider">Licenze Autocad</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-4xl font-black text-blue-600">{pcStats.autocadCompletoCount}</span>
                <span className="text-gray-400 font-bold">/ {licenseLimits.autocadCompletoTotali} in uso</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 mt-4 overflow-hidden">
                <div 
                  className={`h-2 rounded-full transition-all duration-500 ${
                    pcStats.autocadCompletoCount > licenseLimits.autocadCompletoTotali ? 'bg-red-500 animate-pulse' : 'bg-blue-600'
                  }`}
                  style={{ width: `${Math.min((pcStats.autocadCompletoCount / (licenseLimits.autocadCompletoTotali || 1)) * 100, 100)}%` }}
                />
              </div>
              <span className="text-xs font-bold text-gray-500 mt-2">
                {pcStats.autocadCompletoCount > licenseLimits.autocadCompletoTotali 
                  ? "⚠️ Limite superato!" 
                  : `${Math.max(licenseLimits.autocadCompletoTotali - pcStats.autocadCompletoCount, 0)} libere`}
              </span>
            </div>

            <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50 flex flex-col justify-between">
              <span className="text-xs font-extrabold text-cyan-500 uppercase tracking-wider">Licenze Autocad LT</span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-4xl font-black text-cyan-600">{pcStats.autocadLtCount}</span>
                <span className="text-gray-400 font-bold">/ {licenseLimits.autocadLtTotali} in uso</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 mt-4 overflow-hidden">
                <div 
                  className={`h-2 rounded-full transition-all duration-500 ${
                    pcStats.autocadLtCount > licenseLimits.autocadLtTotali ? 'bg-red-500 animate-pulse' : 'bg-cyan-500'
                  }`}
                  style={{ width: `${Math.min((pcStats.autocadLtCount / (licenseLimits.autocadLtTotali || 1)) * 100, 100)}%` }}
                />
              </div>
              <span className="text-xs font-bold text-gray-500 mt-2">
                {pcStats.autocadLtCount > licenseLimits.autocadLtTotali 
                  ? "⚠️ Limite superato!" 
                  : `${Math.max(licenseLimits.autocadLtTotali - pcStats.autocadLtCount, 0)} libere`}
              </span>
            </div>
          </div>

          {/* Visualizzazione PC Raggruppata */}
          {pcsList.length === 0 ? (
            <div className="bg-white/80 rounded-[2rem] p-12 text-center text-gray-400 font-bold border border-white/50 w-full">
              Nessun PC registrato nel sistema. Gli Admin possono precaricare i PC predefiniti nel tab "Gestione".
            </div>
          ) : (
            <div className="space-y-12 w-full">
              {/* Filtro Postazioni Libere */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white/80 backdrop-blur-xl p-4 rounded-3xl border border-gray-100/90 gap-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-teal-50 rounded-2xl">
                    <Filter className="w-4 h-4 text-teal-650" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-gray-805 uppercase tracking-wider">Filtra Postazioni</h3>
                    <p className="text-[11px] text-gray-400 font-bold">Visualizza solo i PC disponibili per la prenotazione.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex bg-gray-100 p-1 rounded-2xl gap-1">
                    <button
                      type="button"
                      onClick={() => setShowOnlyFree(false)}
                      className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                        !showOnlyFree ? 'bg-white text-teal-650 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      Tutte ({pcsList.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowOnlyFree(true)}
                      className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                        showOnlyFree ? 'bg-white text-teal-650 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      Solo Libere ({pcsList.filter(pc => !pc.statoCorrente?.occupato && !(!pc.statoCorrente?.occupato && getTwinStatus(pc).areAllTwinLicensesInUse)).length})
                    </button>
                  </div>
                </div>
              </div>

              {filteredPcsList.length === 0 ? (
                <div className="bg-white/80 rounded-[2rem] p-12 text-center text-gray-500 border border-white/50 w-full flex flex-col items-center justify-center gap-3">
                  <Info className="w-8 h-8 text-amber-500" />
                  <span className="font-extrabold text-gray-800">Nessuna postazione libera</span>
                  <p className="text-xs text-gray-400 max-w-sm leading-relaxed">
                    Tutte le macchine virtuali o le licenze sono attualmente occupate. Disattiva il filtro "Solo Libere" per visualizzare tutte le postazioni.
                  </p>
                </div>
              ) : (
                <>
                  {/* Sezione AEC Collection Personali */}
                  {Object.keys(aecGroups.groups).length > 0 && (
                    <div className="space-y-6">
                      <div className="border-b border-gray-100 pb-2">
                        <h2 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                          <Laptop className="w-5 h-5 text-indigo-600" />
                          <span>Gestione PC Condivisi da Remoto</span>
                        </h2>
                      </div>

                      {/* Scritta di Avviso in Alto */}
                      <div className="bg-indigo-50/70 border border-indigo-100/80 rounded-2xl p-4 text-indigo-950 font-medium text-sm flex gap-3 items-start">
                        <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                        <p className="leading-relaxed">
                          Per le macchine con licenza AEC Collection si prega di mettersi prima d'accordo a voce e segnare se si utilizza Autocad o Revit, in modo da gestire al meglio le licenze condivise e poter utilizzare le macchine con lo stesso disegnatore assegnato.
                        </p>
                      </div>

                      <div className="space-y-4">
                        {Object.entries(aecGroups.groups).sort((a, b) => a[0].localeCompare(b[0])).map(([userKey, groupPcs]) => {
                          return (
                            <div key={userKey} className="bg-gray-50/50 rounded-2xl p-4 border border-gray-100/80 space-y-3">
                              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 px-2">
                                <div>
                                  <h3 className="text-sm font-black text-indigo-600 uppercase flex items-center gap-1.5">
                                    <span>{userKey}</span>
                                  </h3>
                                </div>
                              </div>

                              <div className="flex flex-col gap-2">
                                {groupPcs.sort((a,b) => a.id.localeCompare(b.id)).map(pc => renderPcCard(pc))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Sezione Altre AEC non assegnate */}
                  {aecGroups.otherPcs.length > 0 && (
                    <div className="space-y-6">
                      <div className="border-b border-gray-100 pb-2">
                        <h2 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                          <Laptop className="w-5 h-5 text-indigo-600" />
                          <span>Altre Postazioni AEC Collection (Non Assegnate)</span>
                        </h2>
                      </div>
                      <div className="flex flex-col gap-2">
                        {aecGroups.otherPcs.map(pc => renderPcCard(pc))}
                      </div>
                    </div>
                  )}

                  {/* Sezione AutoCAD LT */}
                  {aecGroups.ltPcs.length > 0 && (
                    <div className="space-y-6">
                      <div className="border-b border-gray-100 pb-2">
                        <h2 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                          <Laptop className="w-5 h-5 text-teal-600" />
                          <span>Postazioni AutoCAD LT</span>
                        </h2>
                      </div>
                      <div className="flex flex-col gap-2">
                        {aecGroups.ltPcs.map(pc => renderPcCard(pc))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* --- TAB 2: SALE RIUNIONI --- */}
      {activeTab === 'room' && (
        <div className="space-y-8 animate-in fade-in">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Sezione Sinistra: Nuova Prenotazione & Info (5 colonne) */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50">
              <h3 className="text-lg font-extrabold text-gray-900 mb-4 flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-indigo-600" />
                <span>Prenota una Sala</span>
              </h3>
              
              <form onSubmit={handleBookRoomSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Seleziona Sala</label>
                  <select
                    required
                    value={roomBookingData.roomId}
                    onChange={e => setRoomBookingData(prev => ({ ...prev, roomId: e.target.value }))}
                    className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                  >
                    <option value="">Scegli una sala...</option>
                    {roomsList.map(r => (
                      <option key={r.id} value={r.id}>{r.nome}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Data</label>
                  <input
                    required
                    type="date"
                    value={roomBookingData.date}
                    onChange={e => setRoomBookingData(prev => ({ ...prev, date: e.target.value }))}
                    className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Ora Inizio</label>
                    <input
                      required
                      type="time"
                      value={roomBookingData.startTime}
                      onChange={e => setRoomBookingData(prev => ({ ...prev, startTime: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Ora Fine</label>
                    <input
                      required
                      type="time"
                      value={roomBookingData.endTime}
                      onChange={e => setRoomBookingData(prev => ({ ...prev, endTime: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Scopo Riunione / Note</label>
                  <textarea
                    rows={3}
                    placeholder="Es. Riunione PM con cliente Rossi per Commessa X"
                    value={roomBookingData.note}
                    onChange={e => setRoomBookingData(prev => ({ ...prev, note: e.target.value }))}
                    className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-semibold text-gray-700 outline-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl transition text-xs shadow-md active:scale-98"
                >
                  Conferma Prenotazione
                </button>
              </form>
            </div>

            {/* Info Box */}
            <div className="bg-blue-50/70 border border-blue-100 rounded-[2rem] p-5 text-blue-900 font-medium text-xs flex gap-3">
              <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-extrabold text-sm text-blue-950">Informazioni e Regolamento</div>
                <p className="leading-relaxed">
                  Per evitare discussioni o sovrapposizioni, prenota la sala prima del meeting. Il sistema effettua un controllo orario in tempo reale ed impedisce prenotazioni simultanee della stessa risorsa.
                </p>
                <p className="leading-relaxed pt-1.5">
                  I dipendenti possono cancellare solo le proprie prenotazioni, mentre HR e Admin possono rimuovere qualunque slot.
                </p>
              </div>
            </div>
          </div>

          {/* Sezione Destra: Lista Prenotazioni Future (7 colonne) */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50 flex flex-col min-h-[400px]">
              <h3 className="text-lg font-extrabold text-gray-900 mb-4 flex items-center gap-2 border-b border-gray-50 pb-3">
                <Clock className="w-5 h-5 text-indigo-600" />
                <span>Calendario Prenotazioni Sale</span>
              </h3>

              <div className="space-y-4 flex-1">
                {roomBookingsSorted.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center py-12 text-gray-400">
                    <CalendarDays className="w-10 h-10 stroke-[1.5] opacity-50 mb-2" />
                    <p className="text-sm font-bold italic">Nessuna prenotazione attiva o futura.</p>
                  </div>
                ) : (
                  roomBookingsSorted.map(b => {
                    const roomName = resources.find(r => r.id === b.risorsaId)?.nome || b.risorsaId;
                    const dateStr = new Date(b.dataInizio).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const startH = b.dataInizio.split('T')[1].substring(0, 5);
                    const endH = b.dataFine.split('T')[1].substring(0, 5);
                    const isMe = b.dipendenteEmail?.toLowerCase() === currentUserEmail?.toLowerCase();

                    return (
                      <div key={b.id} className="p-4 bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md transition flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="bg-indigo-100 text-indigo-800 text-[10px] font-black uppercase px-2 py-0.5 rounded-full">
                              {roomName}
                            </span>
                            <span className="text-xs font-bold text-gray-500">
                              {dateStr} dalle {startH} alle {endH}
                            </span>
                          </div>
                          <div className="text-sm font-bold text-gray-800">
                            Referente: {b.dipendenteNome} {isMe && <span className="text-[10px] font-medium text-indigo-600">(Tu)</span>}
                          </div>
                          {b.note && (
                            <p className="text-xs text-gray-600 italic mt-1 font-medium bg-gray-50 p-2 rounded-xl">
                              "{b.note}"
                            </p>
                          )}
                        </div>

                        {(isMe || isAdmin) && (
                          <button
                            onClick={() => handleCancelBooking(b)}
                            className="text-gray-400 hover:text-red-600 p-1.5 rounded-xl hover:bg-red-50 transition shrink-0 self-end sm:self-center"
                            title="Elimina prenotazione"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
          </div>
        </div>
      </div>
    </div>
          
          {/* CALENDARIO SALE */}
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-md p-6 sm:p-8 border border-white/50 no-print">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-extrabold text-xl text-gray-900 capitalize flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-indigo-600" />
                <span>Calendario Mensile Sale - {monthNameRoom}</span>
              </h3>
              <div className="flex items-center gap-1 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm">
                <button type="button" onClick={() => shiftMonthRoom(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition"><ChevronLeft className="w-4 h-4" /></button>
                <button type="button" onClick={() => setCurrentMonthRoom(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="px-4 py-2 text-xs font-extrabold text-gray-700 hover:bg-gray-100 rounded-lg transition">Oggi</button>
                <button type="button" onClick={() => shiftMonthRoom(1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-2 mb-2">
              {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => (
                <div key={d} className="text-center font-bold text-gray-400 text-xs py-2">{d}</div>
              ))}
            </div>
            
            <div className="grid grid-cols-7 gap-2">
              {getRoomCalendarCells()}
            </div>
          </div>
        </div>
      )}

      {/* --- TAB 3: AUTO AZIENDALI --- */}
      {activeTab === 'car' && (
        <div className="space-y-6">
          {/* Sezione: Check-in / Check-out Odierni per l'Utente */}
          {activeCarBookingsForUser.length > 0 && (
            <div className="bg-gradient-to-r from-teal-50 to-emerald-50 border border-emerald-100 rounded-[2rem] p-6 shadow-sm">
              <h3 className="text-lg font-black text-emerald-950 flex items-center gap-2 mb-3">
                <Car className="w-6 h-6 text-emerald-600 animate-pulse" />
                <span>La tua auto di oggi</span>
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                {activeCarBookingsForUser.map(b => {
                  const car = resources.find(r => r.id === b.risorsaId);
                  const carName = car ? `${car.nome} (${car.dettagli.modello})` : b.risorsaId;
                  const isConcorso = b.statoUso === 'in_corso';

                  return (
                    <div key={b.id} className="bg-white/90 backdrop-blur rounded-2xl p-5 border border-emerald-100 flex flex-col justify-between gap-4">
                      <div>
                        <div className="flex justify-between items-center border-b border-gray-50 pb-2">
                          <span className="text-sm font-extrabold text-gray-800">{carName}</span>
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                            isConcorso ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {isConcorso ? 'In Viaggio' : 'Prenotata'}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-gray-500 mt-2">
                          Prenotazione: dal {b.dataInizio.substring(0, 10)} al {b.dataFine.substring(0, 10)}
                        </div>
                        <div className="text-xs font-medium text-gray-700 mt-1 italic">
                          Scopo: "{b.note}"
                        </div>
                        {isConcorso && (
                          <div className="text-xs font-bold text-indigo-700 mt-2">
                            Km Inizio Viaggio: {b.kmPresaInCarico} km (alle {new Date(b.orarioEffettivoInizio!).toLocaleTimeString('it-IT', {hour:'2-digit', minute:'2-digit'})})
                          </div>
                        )}
                      </div>

                      <div>
                        {!isConcorso ? (
                          <button
                            onClick={() => {
                              setSelectedCarBooking(b);
                              setCarKmInput('');
                              setIsCarCheckInModalOpen(true);
                            }}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl transition text-xs shadow"
                          >
                            Prendi in consegna (Check-in)
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setSelectedCarBooking(b);
                              setCarKmInput('');
                              setCarDestInput('');
                              setIsCarCheckOutModalOpen(true);
                            }}
                            className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-2.5 rounded-xl transition text-xs shadow"
                          >
                            Termina utilizzo (Check-out / Restituzione)
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Griglia Calendario & Registro Storico */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Sezione Sinistra: Prenotazione & Calendario Auto (5 colonne) */}
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50">
                <h3 className="text-lg font-extrabold text-gray-900 mb-4 flex items-center gap-2">
                  <Car className="w-5 h-5 text-teal-600" />
                  <span>Prenota un Autoveicolo</span>
                </h3>

                <form onSubmit={handleBookCarSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Seleziona Auto</label>
                    <select
                      required
                      value={carBookingData.carId}
                      onChange={e => setCarBookingData(prev => ({ ...prev, carId: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    >
                      <option value="">Scegli un'auto...</option>
                      {carsList.map(c => (
                        <option key={c.id} value={c.id}>{c.nome}{c.dettagli.targa ? ` (${c.dettagli.targa})` : ''}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Data Inizio</label>
                      <input
                        required
                        type="date"
                        value={carBookingData.startDate}
                        onChange={e => setCarBookingData(prev => ({ ...prev, startDate: e.target.value }))}
                        className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Data Fine</label>
                      <input
                        required
                        type="date"
                        value={carBookingData.endDate}
                        onChange={e => setCarBookingData(prev => ({ ...prev, endDate: e.target.value }))}
                        className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Destinazione / Missione</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. Sopralluogo cantiere GSK Rosia"
                      value={carBookingData.note}
                      onChange={e => setCarBookingData(prev => ({ ...prev, note: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3.5 rounded-xl transition text-xs shadow-md active:scale-98"
                  >
                    Prenota Auto
                  </button>
                </form>
              </div>

              {/* Prossimi Viaggi */}
              <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50">
                <h3 className="text-base font-extrabold text-gray-900 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-teal-600" />
                  <span>Prossime Prenotazioni Auto</span>
                </h3>
                <div className="space-y-3">
                  {carBookingsSorted.length === 0 ? (
                    <div className="text-center py-6 text-xs text-gray-400 font-bold italic">Nessun viaggio pianificato.</div>
                  ) : (
                    carBookingsSorted.map(cb => {
                      const carName = resources.find(r => r.id === cb.risorsaId)?.nome || cb.risorsaId;
                      const isMe = cb.dipendenteEmail?.toLowerCase() === currentUserEmail?.toLowerCase();
                      return (
                        <div key={cb.id} className="p-3 bg-gray-50 border border-gray-100 rounded-xl flex justify-between items-center gap-3">
                          <div className="text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="font-extrabold text-teal-700">{carName}</span>
                              <span className="text-gray-400">|</span>
                              <span className="font-bold text-gray-500">
                                {cb.dataInizio.substring(0, 10)} / {cb.dataFine.substring(0, 10)}
                              </span>
                            </div>
                            <div className="font-bold text-gray-700 mt-0.5">Guidatore: {cb.dipendenteNome}</div>
                            <div className="text-gray-500 italic mt-0.5">Dest: "{cb.note}"</div>
                          </div>
                          {(isMe || isAdmin) && (
                            <button
                              onClick={() => handleCancelBooking(cb)}
                              className="text-gray-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Sezione Destra: Registro Utilizzo Storico (7 colonne) */}
            <div className="lg:col-span-7 space-y-6">
              <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50 min-h-[400px] flex flex-col">
                <h3 className="text-lg font-extrabold text-gray-900 mb-4 flex items-center gap-2 border-b border-gray-50 pb-3">
                  <History className="w-5 h-5 text-teal-600" />
                  <span>Registro Storico Uso Autoveicoli</span>
                </h3>

                <div className="flex-1 overflow-x-auto">
                  {carHistoryLogs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-12 text-gray-400">
                      <History className="w-10 h-10 stroke-[1.5] opacity-50 mb-2" />
                      <p className="text-sm font-bold italic">Nessun viaggio registrato nel log storico.</p>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs font-medium text-gray-600">
                      <thead>
                        <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase tracking-wider text-[10px]">
                          <th className="py-3 px-2">Data Viaggio</th>
                          <th className="py-3 px-2">Guidatore</th>
                          <th className="py-3 px-2">Auto</th>
                          <th className="py-3 px-2">Km Percorsi</th>
                          <th className="py-3 px-2">Destinazione</th>
                        </tr>
                      </thead>
                      <tbody>
                        {carHistoryLogs.map(log => {
                          const carName = resources.find(r => r.id === log.risorsaId)?.nome || log.risorsaId;
                          const startD = log.dataInizio.substring(0, 10);
                          const kmStart = log.kmPresaInCarico || 0;
                          const kmEnd = log.kmFineUtilizzo || 0;
                          const totalKm = kmEnd - kmStart;

                          return (
                            <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition">
                              <td className="py-3 px-2 font-bold text-gray-900">{startD}</td>
                              <td className="py-3 px-2 font-bold text-gray-800">{log.dipendenteNome}</td>
                              <td className="py-3 px-2">{carName}</td>
                              <td className="py-3 px-2 font-bold text-gray-800">
                                {totalKm} km <span className="text-[10px] text-gray-400 font-medium">({kmStart} ➔ {kmEnd})</span>
                              </td>
                              <td className="py-3 px-2 italic text-gray-500 max-w-[150px] truncate" title={log.note}>{log.note}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* CALENDARIO AUTO */}
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-md p-6 sm:p-8 border border-white/50 no-print">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-extrabold text-xl text-gray-900 capitalize flex items-center gap-2">
                <Car className="w-5 h-5 text-teal-600" />
                <span>Calendario Mensile Auto - {monthNameCar}</span>
              </h3>
              <div className="flex items-center gap-1 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm">
                <button type="button" onClick={() => shiftMonthCar(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition"><ChevronLeft className="w-4 h-4" /></button>
                <button type="button" onClick={() => setCurrentMonthCar(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="px-4 py-2 text-xs font-extrabold text-gray-700 hover:bg-gray-100 rounded-lg transition">Oggi</button>
                <button type="button" onClick={() => shiftMonthCar(1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-2 mb-2">
              {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => (
                <div key={d} className="text-center font-bold text-gray-400 text-xs py-2">{d}</div>
              ))}
            </div>
            
            <div className="grid grid-cols-7 gap-2">
              {getCarCalendarCells()}
            </div>

            <div className="mt-6 flex flex-wrap gap-4 p-4 bg-gray-50/50 rounded-2xl border border-gray-100 justify-center">
              <div className="text-xs font-bold text-gray-500 mr-2">Legenda Colori Stato Auto:</div>
              <div className="flex items-center gap-2 text-[11px] font-bold text-gray-700"><span className="w-2.5 h-2.5 rounded-full bg-teal-400 shadow-sm"></span> Prenotato</div>
              <div className="flex items-center gap-2 text-[11px] font-bold text-gray-700"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-sm"></span> In Viaggio</div>
              <div className="flex items-center gap-2 text-[11px] font-bold text-gray-700"><span className="w-2.5 h-2.5 rounded-full bg-gray-400 shadow-sm"></span> Concluso (Storico)</div>
            </div>
          </div>
        </div>
      )}

      {/* --- TAB 4: AMMINISTRAZIONE / GESTIONE RISORSE --- */}
      {activeTab === 'admin' && isAdmin && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Pannello Risorse */}
            <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50 flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-black text-gray-900 mb-2 flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-red-600" />
                  <span>Pannello di Amministrazione Risorse</span>
                </h3>
                <p className="text-xs font-bold text-gray-500 mb-4 leading-normal">
                  Questo pannello consente di inserire o rimuovere le risorse prenotabili (PC, Sale, Auto) nel database.
                </p>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => setIsAdminAddResourceOpen(true)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow flex items-center gap-1.5 transition active:scale-95 w-full md:w-auto"
                >
                  <Plus className="w-4 h-4" /> Aggiungi Nuova Risorsa
                </button>
              </div>
            </div>

            {/* Configurazione Limiti Licenze */}
            <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50 flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-black text-gray-900 mb-2 flex items-center gap-2">
                  <Laptop className="w-5 h-5 text-indigo-600" />
                  <span>Configura Limiti Licenze CAD</span>
                </h3>
                <p className="text-xs font-bold text-gray-500 mb-4 leading-normal">
                  Imposta il limite massimo di licenze Revit, AutoCAD Completo e AutoCAD LT della ditta da monitorare.
                </p>
              </div>

              <form onSubmit={handleSaveLicenseLimits} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 ml-1">Revit Totali</label>
                    <input
                      required
                      type="number"
                      min={0}
                      value={revitInput}
                      onChange={e => setRevitInput(Number(e.target.value))}
                      className="w-full p-2.5 text-xs border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 ml-1">AutoCAD Completo</label>
                    <input
                      required
                      type="number"
                      min={0}
                      value={autocadCompletoInput}
                      onChange={e => setAutocadCompletoInput(Number(e.target.value))}
                      className="w-full p-2.5 text-xs border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 ml-1">AutoCAD LT</label>
                    <input
                      required
                      type="number"
                      min={0}
                      value={autocadLtInput}
                      onChange={e => setAutocadLtInput(Number(e.target.value))}
                      className="w-full p-2.5 text-xs border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-xl text-xs shadow transition active:scale-95 whitespace-nowrap w-full sm:w-auto"
                  >
                    Salva Limiti
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Elenco Risorse Esistenti */}
          <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50">
            <h3 className="text-base font-extrabold text-gray-900 mb-4">Elenco Risorse Attive in Database ({resources.length})</h3>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-medium text-gray-600">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Tipo</th>
                    <th className="py-3 px-4">Identificativo</th>
                    <th className="py-3 px-4">Nome Display</th>
                    <th className="py-3 px-4">Dettagli Risorsa</th>
                    <th className="py-3 px-4 text-center">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {resources.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-gray-400 font-bold italic">Nessuna risorsa presente nel database. Premi "Carica Risorse Standard" in alto.</td>
                    </tr>
                  ) : (
                    resources
                      .sort((a, b) => a.tipo.localeCompare(b.tipo) || a.id.localeCompare(b.id))
                      .map(res => {
                        let detailsStr = '';
                        if (res.tipo === 'pc') {
                          detailsStr = `IP: ${res.dettagli.ipAddress} | Licenza: ${res.dettagli.licenzaAutodesk} | Utente: ${res.dettagli.utenteIngegno}`;
                        } else if (res.tipo === 'room') {
                          detailsStr = `Sede: ${res.dettagli.sede}`;
                        } else if (res.tipo === 'car') {
                          detailsStr = `Modello: ${res.dettagli.modello} | Targa: ${res.dettagli.targa || '-'} | Sede: ${res.dettagli.sede}`;
                        }

                        return (
                          <tr key={res.docId || `${res.tipo}_${res.id}`} className="border-b border-gray-50 hover:bg-gray-50/50 transition">
                            <td className="py-3 px-4">
                              <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                                res.tipo === 'pc' 
                                  ? 'bg-teal-100 text-teal-800' 
                                  : res.tipo === 'room' 
                                    ? 'bg-indigo-100 text-indigo-800' 
                                    : 'bg-amber-100 text-amber-800'
                              }`}>
                                {res.tipo === 'pc' ? 'Workstation' : res.tipo === 'room' ? 'Sala Riunioni' : 'Autovettura'}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-bold text-gray-900">{res.id}</td>
                            <td className="py-3 px-4 font-bold text-gray-800">{res.nome}</td>
                            <td className="py-3 px-4 text-gray-500 font-medium">{detailsStr}</td>
                            <td className="py-3 px-4 text-center">
                              <button
                                onClick={() => handleDeleteResource(res)}
                                className="text-gray-400 hover:text-red-600 p-1.5 rounded-xl hover:bg-red-50 transition"
                                title="Elimina risorsa"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* --- MODALS SECTION --- */}

      {/* 1. Modal Claim PC */}
      {isClaimPCModalOpen && selectedPC && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full border border-gray-100 p-6 flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <Laptop className="w-5 h-5 text-teal-600" />
                <span>Prendi in uso {selectedPC.id}</span>
              </h3>
              <button 
                onClick={() => setIsClaimPCModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleClaimPCSubmit} className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-2xl text-xs space-y-1 font-medium text-gray-600">
                <div className="font-extrabold text-gray-800 text-sm mb-1">Dettagli Collegamento RDP:</div>
                <div>IP: <span className="font-bold text-gray-900">{selectedPC.dettagli.ipAddress}</span></div>
                <div>Credenziali: <span className="font-bold text-gray-900">{selectedPC.dettagli.utenteIngegno}</span> / <span className="font-bold text-gray-900 select-all">{selectedPC.dettagli.pswUtente}</span></div>
                <div className="pt-2 text-[10px] text-gray-400">Assicurati di disconnetterti e rilasciare la postazione a fine lavoro!</div>
              </div>

              <div className="space-y-2 border-t border-gray-100 pt-3">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Utilizzo Licenze Autodesk</label>
                
                {selectedPC.dettagli.licenzaAutodesk !== 'Autocad LT' && (
                  <label className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer select-none ${
                    getTwinStatus(selectedPC).isTwinRevitInUse 
                      ? 'bg-gray-100 border-gray-200 text-gray-450 cursor-not-allowed opacity-60' 
                      : 'bg-gray-50 hover:bg-gray-100/70 border-transparent text-gray-800'
                  }`}>
                    <input
                      type="checkbox"
                      checked={useRevit}
                      disabled={getTwinStatus(selectedPC).isTwinRevitInUse}
                      onChange={e => setUseRevit(e.target.checked)}
                      className={`w-4.5 h-4.5 text-teal-600 rounded border-gray-300 focus:ring-teal-500 ${
                        getTwinStatus(selectedPC).isTwinRevitInUse ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    />
                    <div>
                      <div className="text-xs font-extrabold">
                        <span>Licenza Revit</span>
                        {getTwinStatus(selectedPC).isTwinRevitInUse && (
                          <span className="text-rose-600 font-extrabold text-[9px] ml-2 uppercase bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">
                            In uso sul gemello
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400">Occupa uno slot delle licenze Revit della ditta</div>
                    </div>
                  </label>
                )}

                <label className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer select-none ${
                  getTwinStatus(selectedPC).isTwinAutocadInUse 
                    ? 'bg-gray-100 border-gray-200 text-gray-450 cursor-not-allowed opacity-60' 
                    : 'bg-gray-50 hover:bg-gray-100/70 border-transparent text-gray-800'
                }`}>
                  <input
                    type="checkbox"
                    checked={useAutoCAD}
                    disabled={getTwinStatus(selectedPC).isTwinAutocadInUse}
                    onChange={e => setUseAutoCAD(e.target.checked)}
                    className={`w-4.5 h-4.5 text-teal-600 rounded border-gray-300 focus:ring-teal-500 ${
                      getTwinStatus(selectedPC).isTwinAutocadInUse ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-extrabold">
                      <span>
                        {selectedPC.dettagli.licenzaAutodesk === 'Autocad LT' 
                          ? 'Licenza Autocad LT' 
                          : 'Licenza Autocad'}
                      </span>
                      {getTwinStatus(selectedPC).isTwinAutocadInUse && (
                        <span className="text-rose-600 font-extrabold text-[9px] ml-2 uppercase bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">
                          In uso sul gemello
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {selectedPC.dettagli.licenzaAutodesk === 'Autocad LT'
                        ? 'Occupa uno slot delle licenze AutoCAD LT della ditta'
                        : 'Occupa uno slot delle licenze AutoCAD Completo della ditta'}
                    </div>
                  </div>
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsClaimPCModalOpen(false)}
                  className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 px-4 rounded-xl bg-teal-600 text-white text-xs font-bold hover:bg-teal-700 transition active:scale-95 shadow"
                >
                  Conferma Collegamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 1b. Modal Edit PC Licenses */}
      {isEditPCModalOpen && selectedPC && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full border border-gray-100 p-6 flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-indigo-600" />
                <span>Modifica Licenze {selectedPC.id}</span>
              </h3>
              <button 
                onClick={() => setIsEditPCModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditPCSubmit} className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-2xl text-xs space-y-1 font-medium text-gray-650">
                <div className="font-extrabold text-gray-800 text-sm mb-1">Modifica delle licenze in uso:</div>
                <div>Puoi selezionare o deselezionare Revit e AutoCAD a seconda della tua attività corrente. I limiti delle licenze dell'utenza e dei gemelli restano attivi.</div>
              </div>

              <div className="space-y-2 border-t border-gray-100 pt-3">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Utilizzo Licenze Autodesk</label>
                
                {selectedPC.dettagli.licenzaAutodesk !== 'Autocad LT' && (
                  <label className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer select-none ${
                    getTwinStatus(selectedPC).isTwinRevitInUse 
                      ? 'bg-gray-100 border-gray-200 text-gray-455 cursor-not-allowed opacity-60' 
                      : 'bg-gray-50 hover:bg-gray-100/70 border-transparent text-gray-800'
                  }`}>
                    <input
                      type="checkbox"
                      checked={useRevit}
                      disabled={getTwinStatus(selectedPC).isTwinRevitInUse}
                      onChange={e => setUseRevit(e.target.checked)}
                      className={`w-4.5 h-4.5 text-teal-600 rounded border-gray-300 focus:ring-teal-500 ${
                        getTwinStatus(selectedPC).isTwinRevitInUse ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    />
                    <div>
                      <div className="text-xs font-extrabold">
                        <span>Licenza Revit</span>
                        {getTwinStatus(selectedPC).isTwinRevitInUse && (
                          <span className="text-rose-600 font-extrabold text-[9px] ml-2 uppercase bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">
                            In uso sul gemello
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400">Occupa uno slot delle licenze Revit della ditta</div>
                    </div>
                  </label>
                )}

                <label className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer select-none ${
                  getTwinStatus(selectedPC).isTwinAutocadInUse 
                    ? 'bg-gray-100 border-gray-200 text-gray-455 cursor-not-allowed opacity-60' 
                    : 'bg-gray-50 hover:bg-gray-100/70 border-transparent text-gray-800'
                }`}>
                  <input
                    type="checkbox"
                    checked={useAutoCAD}
                    disabled={getTwinStatus(selectedPC).isTwinAutocadInUse}
                    onChange={e => setUseAutoCAD(e.target.checked)}
                    className={`w-4.5 h-4.5 text-teal-600 rounded border-gray-300 focus:ring-teal-500 ${
                      getTwinStatus(selectedPC).isTwinAutocadInUse ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-extrabold">
                      <span>
                        {selectedPC.dettagli.licenzaAutodesk === 'Autocad LT' 
                          ? 'Licenza Autocad LT' 
                          : 'Licenza Autocad'}
                      </span>
                      {getTwinStatus(selectedPC).isTwinAutocadInUse && (
                        <span className="text-rose-600 font-extrabold text-[9px] ml-2 uppercase bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">
                          In uso sul gemello
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {selectedPC.dettagli.licenzaAutodesk === 'Autocad LT'
                        ? 'Occupa uno slot delle licenze AutoCAD LT della ditta'
                        : 'Occupa uno slot delle licenze AutoCAD Completo della ditta'}
                    </div>
                  </div>
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditPCModalOpen(false)}
                  className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 px-4 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition active:scale-95 shadow"
                >
                  Salva Modifiche
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Modal Car Check-In */}
      {isCarCheckInModalOpen && selectedCarBooking && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full border border-gray-100 p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Car className="w-5 h-5 text-emerald-600" />
                <span>Prendi in consegna auto</span>
              </h3>
              <button onClick={() => setIsCarCheckInModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCarCheckInSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Km Attuali alla Presa in Carico</label>
                <input
                  required
                  type="number"
                  placeholder="Es. 67663"
                  value={carKmInput}
                  onChange={e => setCarKmInput(e.target.value ? Number(e.target.value) : '')}
                  className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-emerald-500 shadow-inner font-bold text-gray-700 outline-none"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsCarCheckInModalOpen(false)}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition"
                >
                  Inizia Viaggio
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Modal Car Check-Out */}
      {isCarCheckOutModalOpen && selectedCarBooking && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full border border-gray-100 p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Car className="w-5 h-5 text-amber-600" />
                <span>Restituisci auto aziendale</span>
              </h3>
              <button onClick={() => setIsCarCheckOutModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCarCheckOutSubmit} className="space-y-4">
              <div className="text-xs bg-gray-50 p-3 rounded-xl border border-gray-100 text-gray-600">
                Km Registrati a inizio viaggio: <span className="font-extrabold text-gray-900">{selectedCarBooking.kmPresaInCarico} km</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Km Finali a Fine Utilizzo</label>
                <input
                  required
                  type="number"
                  placeholder="Es. 67920"
                  value={carKmInput}
                  onChange={e => setCarKmInput(e.target.value ? Number(e.target.value) : '')}
                  className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-amber-500 shadow-inner font-bold text-gray-700 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Destinazione / Modifica Missione</label>
                <input
                  type="text"
                  placeholder={selectedCarBooking.note}
                  value={carDestInput}
                  onChange={e => setCarDestInput(e.target.value)}
                  className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-amber-500 shadow-inner font-bold text-gray-700 outline-none"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsCarCheckOutModalOpen(false)}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition"
                >
                  Termina Utilizzo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Admin Add Resource Modal */}
      {isAdminAddResourceOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-md w-full border border-gray-100 p-8 flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-200 overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-600" />
                <span>Aggiungi Nuova Risorsa</span>
              </h3>
              <button onClick={() => setIsAdminAddResourceOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddResourceSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Tipo Risorsa</label>
                <select
                  value={newResourceData.tipo}
                  onChange={e => setNewResourceData(prev => ({ ...prev, tipo: e.target.value as 'pc' | 'room' | 'car' }))}
                  className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                >
                  <option value="pc">Postazione CAD (PC Remoto)</option>
                  <option value="room">Sala Riunioni</option>
                  <option value="car">Autovettura Aziendale</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Identificativo Risorsa (ID unico, es. ING_PC_20, diaz, panda)</label>
                <input
                  required
                  type="text"
                  placeholder="Es. ING_WSN_20 o diaz"
                  value={newResourceData.id}
                  onChange={e => setNewResourceData(prev => ({ ...prev, id: e.target.value }))}
                  className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Nome Display (es. Sala Diaz, ING_WSN_20)</label>
                <input
                  required
                  type="text"
                  placeholder="Es. Sala Diaz o Fiat C3"
                  value={newResourceData.nome}
                  onChange={e => setNewResourceData(prev => ({ ...prev, nome: e.target.value }))}
                  className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                />
              </div>

              {/* PC Specific Details */}
              {newResourceData.tipo === 'pc' && (
                <div className="space-y-4 border-t border-gray-100 pt-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Utente Windows RDP</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. disegnatore01"
                      value={newResourceData.utenteIngegno}
                      onChange={e => setNewResourceData(prev => ({ ...prev, utenteIngegno: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Password Windows RDP</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. Ingegnocad*01"
                      value={newResourceData.pswUtente}
                      onChange={e => setNewResourceData(prev => ({ ...prev, pswUtente: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Tipo Licenza Autodesk</label>
                    <select
                      value={newResourceData.licenzaAutodesk}
                      onChange={e => setNewResourceData(prev => ({ ...prev, licenzaAutodesk: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    >
                      <option value="AEC Collection">AEC Collection (Completa)</option>
                      <option value="Autocad LT">Autocad LT (Base)</option>
                      <option value="Nessuna">Nessuna</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Indirizzo IP Postazione</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. 192.168.10.220"
                      value={newResourceData.ipAddress}
                      onChange={e => setNewResourceData(prev => ({ ...prev, ipAddress: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Programmi Extra / Revit / AutoCAD Versioni</label>
                    <input
                      type="text"
                      placeholder="Es. REVIT 25/24/23 - AUTOCAD 26 - PHOTOSHOP"
                      value={newResourceData.programmiInstallati}
                      onChange={e => setNewResourceData(prev => ({ ...prev, programmiInstallati: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Room Specific Details */}
              {newResourceData.tipo === 'room' && (
                <div className="space-y-4 border-t border-gray-100 pt-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Sede della Sala</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. Via Diaz o Via Gramsci"
                      value={newResourceData.sede}
                      onChange={e => setNewResourceData(prev => ({ ...prev, sede: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Car Specific Details */}
              {newResourceData.tipo === 'car' && (
                <div className="space-y-4 border-t border-gray-100 pt-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Modello Auto</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. Citroen C3"
                      value={newResourceData.modello}
                      onChange={e => setNewResourceData(prev => ({ ...prev, modello: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Targa Autoveicolo</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. AB123CD"
                      value={newResourceData.targa}
                      onChange={e => setNewResourceData(prev => ({ ...prev, targa: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Sede di Parcheggio Auto</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. Via Diaz"
                      value={newResourceData.sede}
                      onChange={e => setNewResourceData(prev => ({ ...prev, sede: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAdminAddResourceOpen(false)}
                  className="flex-1 py-3.5 px-4 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3.5 px-4 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition active:scale-95 shadow"
                >
                  Salva Risorsa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Global Toast */}
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
}
