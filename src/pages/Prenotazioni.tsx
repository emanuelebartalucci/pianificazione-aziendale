import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { 
  collection, 
  getDoc,
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  setDoc,
  query,
  where,
  onSnapshot
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
  Filter, 
  Pencil,
  KeyRound,
  Usb
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';

export interface Resource {
  id: string;
  nome: string;
  tipo: 'pc' | 'room' | 'car' | 'software_key';
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
    // Specifici per software_key
    programma?: string;
    tipoLicenza?: string;
    versioneSoftware?: string;
    serviziAttivi?: string;
    numeroSerie?: string;
    noteSoftware?: string;
  };
  statoCorrente?: {
    occupato: boolean;
    utilizzatoreNome: string | null;
    utilizzatoreEmail: string | null;
    dataInizioUso: string | null;
    revitInUso?: boolean;
    autocadInUso?: boolean;
    altriSoftwareInUso?: string[];
    notaUso?: string;
  };
}

export const DEFAULT_SOFTWARE_KEYS: Omit<Resource, 'docId'>[] = [
  {
    id: 'KEY_EDILUS_USB',
    nome: 'EdiLus (Chiavetta USB)',
    tipo: 'software_key',
    dettagli: {
      programma: 'EDILUS',
      tipoLicenza: 'chiavetta USB',
      versioneSoftware: 'EdiLus-CA +MU +AC +LG +EE usBIM',
      serviziAttivi: 'AmicUS',
      numeroSerie: '13041419'
    },
    statoCorrente: {
      occupato: false,
      utilizzatoreNome: null,
      utilizzatoreEmail: null,
      dataInizioUso: null
    }
  },
  {
    id: 'KEY_EDILUS_2',
    nome: 'EdiLus (2° Licenza senza USB)',
    tipo: 'software_key',
    dettagli: {
      programma: 'EDILUS',
      tipoLicenza: '2° licenza senza USB',
      versioneSoftware: 'EdiLus-CA +MU +AC +LG +EE usBIM',
      serviziAttivi: 'Temporary Soft 1 mese',
      numeroSerie: 'ING_PC_13'
    },
    statoCorrente: {
      occupato: false,
      utilizzatoreNome: null,
      utilizzatoreEmail: null,
      dataInizioUso: null
    }
  },
  {
    id: 'KEY_PRIMUS_USB',
    nome: 'PriMus (Chiavetta USB)',
    tipo: 'software_key',
    dettagli: {
      programma: 'PRIMUS',
      tipoLicenza: 'chiavetta USB',
      versioneSoftware: 'PriMus usBIM',
      serviziAttivi: 'POWER PACK',
      numeroSerie: '20020677'
    },
    statoCorrente: {
      occupato: false,
      utilizzatoreNome: null,
      utilizzatoreEmail: null,
      dataInizioUso: null
    }
  },
  {
    id: 'KEY_PRIMUS_2',
    nome: 'PriMus (2° Licenza senza USB)',
    tipo: 'software_key',
    dettagli: {
      programma: 'PRIMUS',
      tipoLicenza: '2° licenza senza USB',
      versioneSoftware: 'PriMus usBIM (PowerPack)',
      serviziAttivi: 'POWER PACK',
      numeroSerie: '20020677'
    },
    statoCorrente: {
      occupato: false,
      utilizzatoreNome: null,
      utilizzatoreEmail: null,
      dataInizioUso: null
    }
  },
  {
    id: 'KEY_SOLARIUS_USB',
    nome: 'Solarius (Chiavetta USB)',
    tipo: 'software_key',
    dettagli: {
      programma: 'SOLARIUS',
      tipoLicenza: 'chiavetta USB',
      versioneSoftware: 'Solarius-PV 17.00',
      serviziAttivi: '-',
      numeroSerie: '88031886'
    },
    statoCorrente: {
      occupato: false,
      utilizzatoreNome: null,
      utilizzatoreEmail: null,
      dataInizioUso: null
    }
  },
  {
    id: 'KEY_TERMUS_USB_1',
    nome: 'TerMus (Chiavetta USB - S/N 87090262)',
    tipo: 'software_key',
    dettagli: {
      programma: 'TERMUS',
      tipoLicenza: 'chiavetta USB',
      versioneSoftware: 'TerMus +E + TerMus-i 42.00 | Termus BIM + E 52.00',
      serviziAttivi: 'AmicUS',
      numeroSerie: '87090262'
    },
    statoCorrente: {
      occupato: false,
      utilizzatoreNome: null,
      utilizzatoreEmail: null,
      dataInizioUso: null
    }
  },
  {
    id: 'KEY_TERMUS_USB_2',
    nome: 'TerMus (Chiavetta USB - S/N 21123154)',
    tipo: 'software_key',
    dettagli: {
      programma: 'TERMUS',
      tipoLicenza: 'chiavetta USB',
      versioneSoftware: 'TerMus +E 42.00 | Termus BIM + E 52.00',
      serviziAttivi: 'AmicUS',
      numeroSerie: '21123154'
    },
    statoCorrente: {
      occupato: false,
      utilizzatoreNome: null,
      utilizzatoreEmail: null,
      dataInizioUso: null
    }
  }
];

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
  const { isAdmin, isDev, myAssociatedName, userEmail } = useAuth();
  const currentUserName = myAssociatedName || userEmail || 'Dipendente';
  const currentUserEmail = userEmail || '';

  // Tabs: 'pc' | 'software_keys' | 'room' | 'car' | 'admin'
  const [activeTab, setActiveTab] = useState<'pc' | 'software_keys' | 'room' | 'car' | 'admin'>('pc');

  // Filtro postazioni PC: 'all' | 'free' | 'mine'
  const [pcFilter, setPcFilter] = useState<'all' | 'free' | 'mine'>('all');

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

  // Sviluppatore / Admin Edit Resource state
  const [isAdminEditResourceOpen, setIsAdminEditResourceOpen] = useState(false);
  const [editingResourceDocId, setEditingResourceDocId] = useState<string>('');
  const [adminActiveSubSection, setAdminActiveSubSection] = useState<'pc' | 'software_key' | 'room' | 'car' | 'licenses'>('pc');
  
  const [editResourceData, setEditResourceData] = useState({
    id: '',
    nome: '',
    tipo: 'pc' as 'pc' | 'room' | 'car' | 'software_key',
    utenteIngegno: '',
    pswUtente: '',
    licenzaAutodesk: 'AEC Collection',
    programmiInstallati: '',
    ipAddress: '',
    sede: 'Via Diaz',
    modello: '',
    targa: '',
    programma: 'EDILUS',
    tipoLicenza: 'chiavetta USB',
    versioneSoftware: '',
    serviziAttivi: '',
    numeroSerie: ''
  });

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
    tipo: 'pc' as 'pc' | 'room' | 'car' | 'software_key',
    utenteIngegno: '',
    pswUtente: '',
    licenzaAutodesk: 'AEC Collection',
    programmiInstallati: '',
    ipAddress: '',
    sede: 'Via Diaz',
    modello: '',
    targa: '',
    programma: 'EDILUS',
    tipoLicenza: 'chiavetta USB',
    versioneSoftware: '',
    serviziAttivi: '',
    numeroSerie: ''
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

  const loadBookingData = async () => {
    // Carica solo la configurazione licenze (dato statico)
    try {
      const licenseDocSnap = await getDoc(doc(db, 'configurazioni', 'licenze'));
      if (licenseDocSnap.exists()) {
        const data = licenseDocSnap.data();
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
    } catch (err) {
      console.error("Error loading license config:", err);
    }
  };

  useEffect(() => {
    loadBookingData();

    // Listener real-time per le risorse (PC, auto, ecc.)
    const unsubResources = onSnapshot(collection(db, 'risorse'), (snap) => {
      const resList: Resource[] = snap.docs.map((docSnap: any) => ({
        docId: docSnap.id,
        ...docSnap.data()
      } as unknown as Resource));
      setResources(resList);
      setLoading(false);
    }, (err) => {
      console.error("Error listening to risorse:", err);
      showToast("Errore nel caricamento delle risorse.", "error");
      setLoading(false);
    });

    // Listener real-time per le prenotazioni (ultimi 60 giorni + future)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const limitDate = sixtyDaysAgo.toLocaleDateString('sv-SE');
    const unsubBookings = onSnapshot(
      query(collection(db, 'prenotazioni_risorse'), where('dataFine', '>=', limitDate)),
      (snap) => {
        const bookList: Booking[] = snap.docs.map((docSnap: any) => ({
          id: docSnap.id,
          ...docSnap.data()
        } as Booking));
        setBookings(bookList);
      },
      (err) => {
        console.error("Error listening to prenotazioni_risorse:", err);
        showToast("Errore nel caricamento delle prenotazioni.", "error");
      }
    );

    return () => {
      unsubResources();
      unsubBookings();
    };
  }, []);

  // Filtered lists of resources
  const pcsList = useMemo(() => resources.filter(r => r.tipo === 'pc').sort((a, b) => a.id.localeCompare(b.id)), [resources]);

  // Helper per verificare se su un PC sono installati programmi extra oltre a Revit/AutoCAD
  const hasOtherProgramsInstalled = (pc: Resource): boolean => {
    const progs = pc.dettagli?.programmiInstallati;
    if (!progs || !progs.trim()) return false;
    
    // Divide per separatori comuni: virgola, punto e virgola, trattino con spazi, a capo, pipe, ecc.
    const tokens = progs.split(/[,;\n•|]+|(?:\s+-\s+)/).map(t => t.trim().toLowerCase()).filter(Boolean);
    if (tokens.length === 0) return false;

    // Un token è considerato software aggiuntivo se non è riconducibile a Revit o AutoCAD o Autodesk/AEC
    const hasExtra = tokens.some(token => {
      const clean = token.replace(/[\d/.]+/g, '').trim();
      const isAutodeskCore = clean === 'revit' || clean === 'autocad' || clean === 'autocad lt' || clean === 'aec' || clean === 'aec collection' || clean === 'autodesk';
      return !isAutodeskCore;
    });

    return hasExtra;
  };

  const getTwinStatus = (pc: Resource) => {
    const user = pc.dettagli.utenteIngegno?.trim().toLowerCase();
    if (!user || user === 'nessuna' || pc.dettagli.licenzaAutodesk === 'Autocad LT') {
      return {
        hasTwins: false,
        twins: [],
        isTwinRevitInUse: false,
        isTwinAutocadInUse: false,
        areAllTwinLicensesInUse: false,
        hasOtherPrograms: false,
        isDisabledDueToLicenses: false
      };
    }

    const twins = pcsList.filter(other => 
      other.id !== pc.id && 
      other.dettagli.utenteIngegno?.trim().toLowerCase() === user
    );

    const isTwinRevitInUse = twins.some(t => t.statoCorrente?.occupato && t.statoCorrente?.revitInUso);
    const isTwinAutocadInUse = twins.some(t => t.statoCorrente?.occupato && t.statoCorrente?.autocadInUso);
    const areAllTwinLicensesInUse = isTwinRevitInUse && isTwinAutocadInUse;
    const hasOtherPrograms = hasOtherProgramsInstalled(pc);

    return {
      hasTwins: twins.length > 0,
      twins,
      isTwinRevitInUse,
      isTwinAutocadInUse,
      areAllTwinLicensesInUse,
      hasOtherPrograms,
      // Il PC gemello è disattivato SOLO se entrambe le licenze sono esaurite sul gemello E questo PC non ha altri software installati
      isDisabledDueToLicenses: twins.length > 0 && areAllTwinLicensesInUse && !hasOtherPrograms
    };
  };

  const myPcsCount = useMemo(() => {
    if (!currentUserEmail) return 0;
    return pcsList.filter(pc => 
      pc.statoCorrente?.occupato && 
      pc.statoCorrente?.utilizzatoreEmail?.toLowerCase() === currentUserEmail.toLowerCase()
    ).length;
  }, [pcsList, currentUserEmail]);

  const filteredPcsList = useMemo(() => {
    if (pcFilter === 'all') return pcsList;
    if (pcFilter === 'mine') {
      if (!currentUserEmail) return [];
      return pcsList.filter(pc => 
        pc.statoCorrente?.occupato && 
        pc.statoCorrente?.utilizzatoreEmail?.toLowerCase() === currentUserEmail.toLowerCase()
      );
    }
    // pcFilter === 'free'
    return pcsList.filter(pc => {
      const isOccupied = pc.statoCorrente?.occupato;
      if (isOccupied) return false;
      const twinStatus = getTwinStatus(pc);
      const isDisabled = twinStatus.isDisabledDueToLicenses;
      return !isDisabled;
    });
  }, [pcsList, pcFilter, currentUserEmail]);

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

  const softwareKeysList = useMemo(() => {
    const defaultOrderMap = new Map(DEFAULT_SOFTWARE_KEYS.map((k, idx) => [k.id, idx]));
    return resources
      .filter(r => r.tipo === 'software_key')
      .sort((a, b) => {
        const orderA = defaultOrderMap.has(a.id) ? defaultOrderMap.get(a.id)! : 999;
        const orderB = defaultOrderMap.has(b.id) ? defaultOrderMap.get(b.id)! : 999;
        if (orderA !== orderB) return orderA - orderB;
        return (a.dettagli.programma || '').localeCompare(b.dettagli.programma || '') || 
               (a.dettagli.tipoLicenza || '').localeCompare(b.dettagli.tipoLicenza || '') ||
               a.id.localeCompare(b.id);
      });
  }, [resources]);

  const roomsList = useMemo(() => resources.filter(r => r.tipo === 'room').sort((a, b) => a.nome.localeCompare(b.nome)), [resources]);
  const carsList = useMemo(() => resources.filter(r => r.tipo === 'car').sort((a, b) => a.nome.localeCompare(b.nome)), [resources]);

  // Seeding iniziale automatico chiavette se non presenti
  useEffect(() => {
    if (!loading && resources.length > 0) {
      const hasSoftwareKeys = resources.some(r => r.tipo === 'software_key');
      if (!hasSoftwareKeys) {
        handleSeedDefaultSoftwareKeys();
      }
    }
  }, [loading, resources]);

  // Chiavette Software: Seed/Ripristino
  const handleSeedDefaultSoftwareKeys = async () => {
    try {
      for (const key of DEFAULT_SOFTWARE_KEYS) {
        const docId = `software_key_${key.id.toLowerCase()}`;
        await setDoc(doc(db, 'risorse', docId), key, { merge: true });
      }
      showToast("7 Licenze/Chiavette ACCA caricate con successo!");
    } catch (err: any) {
      console.error("Errore nel caricamento licenze default:", err);
      showToast("Errore nel caricamento licenze ACCA: " + err.message, "error");
    }
  };

  // Chiavette Software: Prendi in uso
  const handleClaimSoftwareKey = async (keyRes: Resource) => {
    const docId = keyRes.docId || `software_key_${keyRes.id.toLowerCase()}`;
    try {
      await updateDoc(doc(db, 'risorse', docId), {
        'statoCorrente.occupato': true,
        'statoCorrente.utilizzatoreNome': currentUserName,
        'statoCorrente.utilizzatoreEmail': currentUserEmail,
        'statoCorrente.dataInizioUso': new Date().toISOString()
      });
      showToast(`Licenza ${keyRes.dettagli.programma || keyRes.nome} presa in uso!`);
    } catch (err: any) {
      console.error(err);
      showToast("Errore nella presa in carico: " + err.message, "error");
    }
  };

  // Chiavette Software: Rilascia / Forza rilascio
  const handleReleaseSoftwareKey = (keyRes: Resource, force: boolean = false) => {
    const docId = keyRes.docId || `software_key_${keyRes.id.toLowerCase()}`;
    const actionTitle = force ? "Forza Rilascio Licenza" : "Rilascia Licenza";
    const actionMsg = force 
      ? `Sei sicuro di voler forzare il rilascio di "${keyRes.nome}" attualmente in uso da ${keyRes.statoCorrente?.utilizzatoreNome}?`
      : `Sei sicuro di voler rilasciare la licenza "${keyRes.nome}"?`;

    triggerConfirm(
      actionTitle,
      actionMsg,
      async () => {
        try {
          await updateDoc(doc(db, 'risorse', docId), {
            'statoCorrente.occupato': false,
            'statoCorrente.utilizzatoreNome': null,
            'statoCorrente.utilizzatoreEmail': null,
            'statoCorrente.dataInizioUso': null
          });
          showToast(`Licenza "${keyRes.nome}" rilasciata.`);
        } catch (err: any) {
          console.error(err);
          showToast("Errore nel rilascio: " + err.message, "error");
        }
      }
    );
  };

  // Compute CAD PCs stats
  const pcStats = useMemo(() => {
    const total = pcsList.length;
    const occupied = pcsList.filter(pc => pc.statoCorrente?.occupato).length;
    const disabledCount = pcsList.filter(pc => !pc.statoCorrente?.occupato && getTwinStatus(pc).isDisabledDueToLicenses).length;
    const available = Math.max(0, total - occupied - disabledCount);
    const revitCount = pcsList.filter(pc => pc.statoCorrente?.occupato && pc.statoCorrente?.revitInUso).length;
    const autocadCompletoCount = pcsList.filter(pc => 
      pc.statoCorrente?.occupato && 
      pc.statoCorrente?.autocadInUso && 
      !((pc.dettagli.licenzaAutodesk || '').toLowerCase().includes('lt'))
    ).length;
    const autocadLtCount = pcsList.filter(pc => 
      pc.statoCorrente?.occupato && 
      ((pc.dettagli.licenzaAutodesk || '').toLowerCase().includes('lt'))
    ).length;
    return { 
      total, 
      occupied, 
      disabledCount,
      available, 
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

  // Avvio automatico Connessione Desktop Remoto (RDP)
  const handleConnectRemoteDesktop = (pc: Resource) => {
    const ip = (pc.dettagli.ipAddress || '').trim();
    if (!ip) {
      showToast(`Nessun indirizzo IP specificato per il PC ${pc.id}.`, 'warning');
      return;
    }

    // 1. Copia IP negli appunti come backup
    try {
      navigator.clipboard.writeText(ip);
    } catch (err) {
      console.error("Errore copia appunti IP:", err);
    }

    // 2. Invoca il protocollo Windows registrato ingegno-rdp
    try {
      const protocolUri = `ingegno-rdp:${encodeURIComponent(ip)}`;
      const tempLink = document.createElement('a');
      tempLink.href = protocolUri;
      tempLink.style.display = 'none';
      document.body.appendChild(tempLink);
      tempLink.click();
      setTimeout(() => {
        if (document.body.contains(tempLink)) {
          document.body.removeChild(tempLink);
        }
      }, 1500);
      showToast(`🖥️ Avvio Desktop Remoto per ${pc.id} (${ip})...`, 'success');
    } catch (err) {
      console.error("Errore protocollo ingegno-rdp:", err);
      showToast(`IP ${ip} copiato negli appunti.`, 'success');
    }
  };

  // PC: Claim workstation
  const handleClaimPCSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPC) return;

    const twinStatus = getTwinStatus(selectedPC);
    const isSingle = selectedPC.dettagli.licenzaAutodesk === 'Autocad LT' || !twinStatus.hasTwins;

    if (!isSingle) {
      if (useRevit && twinStatus.isTwinRevitInUse) {
        showToast("La licenza Revit è già in uso sul PC gemello!", "error");
        return;
      }
      if (useAutoCAD && twinStatus.isTwinAutocadInUse) {
        showToast("La licenza AutoCAD è già in uso sul PC gemello!", "error");
        return;
      }
    }

    const docId = `pc_${selectedPC.id.toLowerCase()}`;
    const pcToConnect = selectedPC;
    try {
      await updateDoc(doc(db, 'risorse', docId), {
        'statoCorrente.occupato': true,
        'statoCorrente.utilizzatoreNome': currentUserName,
        'statoCorrente.utilizzatoreEmail': currentUserEmail,
        'statoCorrente.dataInizioUso': new Date().toISOString(),
        'statoCorrente.revitInUso': isSingle ? false : useRevit,
        'statoCorrente.autocadInUso': isSingle ? false : useAutoCAD,
        'statoCorrente.altriSoftwareInUso': []
      });
      showToast(`PC ${pcToConnect.id} preso in carico!`, 'success');

      // Avvio automatico Desktop Remoto compilato
      handleConnectRemoteDesktop(pcToConnect);

      setIsClaimPCModalOpen(false);
      setSelectedPC(null);
      setUseRevit(false);
      setUseAutoCAD(false);
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
    const isSingle = selectedPC.dettagli.licenzaAutodesk === 'Autocad LT' || !twinStatus.hasTwins;

    if (!isSingle) {
      if (useRevit && twinStatus.isTwinRevitInUse) {
        showToast("La licenza Revit è già in uso sul PC gemello!", "error");
        return;
      }
      if (useAutoCAD && twinStatus.isTwinAutocadInUse) {
        showToast("La licenza AutoCAD è già in uso sul PC gemello!", "error");
        return;
      }
    }

    const docId = `pc_${selectedPC.id.toLowerCase()}`;
    try {
      await updateDoc(doc(db, 'risorse', docId), {
        'statoCorrente.revitInUso': isSingle ? false : useRevit,
        'statoCorrente.autocadInUso': isSingle ? false : useAutoCAD,
        'statoCorrente.altriSoftwareInUso': []
      });
      showToast(`Licenze per PC ${selectedPC.id} aggiornate!`);
      setIsEditPCModalOpen(false);
      setSelectedPC(null);
      setUseRevit(false);
      setUseAutoCAD(false);
    } catch (err: any) {
      console.error(err);
      showToast("Errore nell'aggiornamento software: " + err.message, "error");
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
              'statoCorrente.autocadInUso': false,
              'statoCorrente.altriSoftwareInUso': []
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
    const { id, nome, tipo, utenteIngegno, pswUtente, licenzaAutodesk, programmiInstallati, ipAddress, sede, modello, targa, programma, tipoLicenza, versioneSoftware, serviziAttivi, numeroSerie } = newResourceData;
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
    } else if (tipo === 'software_key') {
      details = {
        programma: (programma || 'EDILUS').trim().toUpperCase(),
        tipoLicenza: (tipoLicenza || 'chiavetta USB').trim(),
        versioneSoftware: versioneSoftware.trim(),
        serviziAttivi: serviziAttivi.trim() || '-',
        numeroSerie: numeroSerie.trim()
      };
      statoCorrente = {
        occupato: false,
        utilizzatoreNome: null,
        utilizzatoreEmail: null,
        dataInizioUso: null
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
        targa: '',
        programma: 'EDILUS',
        tipoLicenza: 'chiavetta USB',
        versioneSoftware: '',
        serviziAttivi: '',
        numeroSerie: ''
      });
    } catch (err: any) {
      console.error(err);
      showToast("Errore nel salvataggio: " + err.message, "error");
    }
  };

  // Admin: Open Edit resource modal
  const handleOpenEditResource = (res: Resource) => {
    const docId = res.docId || `${res.tipo}_${res.id.toLowerCase()}`;
    setEditingResourceDocId(docId);
    setEditResourceData({
      id: res.id,
      nome: res.nome,
      tipo: res.tipo,
      utenteIngegno: res.dettagli.utenteIngegno || '',
      pswUtente: res.dettagli.pswUtente || '',
      licenzaAutodesk: res.dettagli.licenzaAutodesk || 'AEC Collection',
      programmiInstallati: res.dettagli.programmiInstallati || '',
      ipAddress: res.dettagli.ipAddress || '',
      sede: res.dettagli.sede || 'Via Diaz',
      modello: res.dettagli.modello || '',
      targa: res.dettagli.targa || '',
      programma: res.dettagli.programma || 'EDILUS',
      tipoLicenza: res.dettagli.tipoLicenza || 'chiavetta USB',
      versioneSoftware: res.dettagli.versioneSoftware || '',
      serviziAttivi: res.dettagli.serviziAttivi || '',
      numeroSerie: res.dettagli.numeroSerie || ''
    });
    setIsAdminEditResourceOpen(true);
  };

  // Admin: Edit existing Resource Submit
  const handleEditResourceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingResourceDocId) return;
    const { id, nome, tipo, utenteIngegno, pswUtente, licenzaAutodesk, programmiInstallati, ipAddress, sede, modello, targa, programma, tipoLicenza, versioneSoftware, serviziAttivi, numeroSerie } = editResourceData;
    if (!id.trim() || !nome.trim()) {
      showToast("Identificativo e Nome sono richiesti.", "warning");
      return;
    }

    let details: any = {};
    if (tipo === 'pc') {
      details = {
        utenteIngegno: utenteIngegno.trim(),
        pswUtente: pswUtente.trim(),
        licenzaAutodesk: licenzaAutodesk.trim(),
        programmiInstallati: programmiInstallati.trim(),
        ipAddress: ipAddress.trim()
      };
    } else if (tipo === 'software_key') {
      details = {
        programma: (programma || 'EDILUS').trim().toUpperCase(),
        tipoLicenza: (tipoLicenza || 'chiavetta USB').trim(),
        versioneSoftware: versioneSoftware.trim(),
        serviziAttivi: serviziAttivi.trim() || '-',
        numeroSerie: numeroSerie.trim()
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

    try {
      await updateDoc(doc(db, 'risorse', editingResourceDocId), {
        id: id.trim(),
        nome: nome.trim(),
        tipo,
        dettagli: details
      });
      showToast(`Risorsa "${nome.trim()}" aggiornata con successo.`);
      setIsAdminEditResourceOpen(false);
    } catch (err: any) {
      console.error(err);
      showToast("Errore nel salvataggio della modifica: " + err.message, "error");
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
    const isSingle = pc.dettagli.licenzaAutodesk === 'Autocad LT' || !twinStatus.hasTwins;
    const isTwinRevitInUse = twinStatus.isTwinRevitInUse;
    const isTwinAutocadInUse = twinStatus.isTwinAutocadInUse;
    const areAllTwinLicensesInUse = twinStatus.areAllTwinLicensesInUse;
    
    // Un PC è disattivato SOLO se non è occupato ed è disabilitato per esaurimento licenze senza altri software
    const isDisabled = !isOccupied && twinStatus.isDisabledDueToLicenses;

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
              
              {!isSingle && (
                <div className="flex flex-col gap-1 mt-1">
                  {pc.statoCorrente?.revitInUso && (
                    <span className="bg-indigo-600 text-white text-[10px] font-black px-2 py-0.5 rounded shadow-sm text-center block w-full max-w-[130px] border border-indigo-700">
                      Licenza Revit
                    </span>
                  )}
                  {pc.statoCorrente?.autocadInUso && (
                    <span className="bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded shadow-sm text-center block w-full max-w-[130px] border border-blue-700">
                      Licenza Autocad
                    </span>
                  )}
                  {!pc.statoCorrente?.revitInUso && !pc.statoCorrente?.autocadInUso && (
                    <span className="bg-purple-100 text-purple-900 text-[10px] font-black px-2 py-0.5 rounded shadow-2xs border border-purple-200 text-center block w-full max-w-[130px]">
                      Altri Software
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : isDisabled ? (
            <div className="text-[10px] text-gray-500 font-bold bg-gray-100 p-1.5 rounded-lg border border-gray-200/50 inline-flex items-center gap-1">
              <span>⚠️ Licenze esaurite sul gemello</span>
            </div>
          ) : (
            <div className="font-bold text-gray-550 flex flex-col gap-0.5">
              <div>
                Licenza Base: <span className="text-gray-700 font-extrabold">{isSingle ? 'Postazione Singola' : 'AEC Collection'}</span>
              </div>
              {!isSingle && twinStatus.hasTwins && (
                <>
                  {areAllTwinLicensesInUse ? (
                    <div className="text-amber-700 bg-amber-50/80 p-1.5 rounded border border-amber-200 leading-tight text-[9px] mt-0.5 font-bold">
                      ⚠️ Revit e AutoCAD su gemello (altri programmi disponibili)
                    </div>
                  ) : (
                    (isTwinRevitInUse || isTwinAutocadInUse) && (
                      <div className="text-amber-700 bg-amber-50/50 px-1.5 py-0.5 rounded border border-amber-100/50 leading-tight text-[9px] mt-0.5 font-bold">
                        {isTwinRevitInUse && <div>• Revit su gemello</div>}
                        {isTwinAutocadInUse && <div>• AutoCAD su gemello</div>}
                      </div>
                    )
                  )}
                </>
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
            <div className="flex flex-col sm:flex-row items-center gap-1.5 w-full justify-end flex-wrap">
              {isMe && (
                <button
                  type="button"
                  onClick={() => handleConnectRemoteDesktop(pc)}
                  className="w-full sm:w-auto px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold rounded-lg transition text-xs shadow flex items-center gap-1 shrink-0 justify-center cursor-pointer"
                  title="Avvia o riconnetti la sessione di Desktop Remoto"
                >
                  <Laptop className="w-3.5 h-3.5" /> Desktop Remoto
                </button>
              )}
              {isMe && !isSingle && (
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
            onClick={() => setActiveTab('software_keys')}
            className={`flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition-all ${
              activeTab === 'software_keys' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <KeyRound className="w-4 h-4" /> Chiavette & Licenze Software
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
          {isDev && (
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
              <div className="flex flex-col mt-2">
                <span className="text-xs font-bold text-gray-700">
                  {pcStats.total - pcStats.occupied} liberi ({pcStats.available} disponibili{pcStats.disabledCount > 0 ? `, ${pcStats.disabledCount} ${pcStats.disabledCount === 1 ? 'disattivo' : 'disattivi'}` : ''})
                </span>
                {pcStats.disabledCount > 0 && (
                  <span className="text-[10px] font-bold text-amber-600 leading-tight mt-0.5">
                    ({pcStats.disabledCount} con licenze Revit/AutoCAD occupate sul gemello)
                  </span>
                )}
              </div>
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
                  <div className="flex bg-gray-100 p-1 rounded-2xl gap-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setPcFilter('all')}
                      className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                        pcFilter === 'all' ? 'bg-white text-teal-650 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      Tutte ({pcsList.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setPcFilter('free')}
                      className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                        pcFilter === 'free' ? 'bg-white text-teal-650 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      Solo Disponibili ({pcStats.available})
                    </button>
                    <button
                      type="button"
                      onClick={() => setPcFilter('mine')}
                      className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                        pcFilter === 'mine' ? 'bg-white text-indigo-650 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      Le mie Postazioni ({myPcsCount})
                    </button>
                  </div>
                </div>
              </div>

              {filteredPcsList.length === 0 ? (
                <div className="bg-white/80 rounded-[2rem] p-12 text-center text-gray-500 border border-white/50 w-full flex flex-col items-center justify-center gap-3">
                  {pcFilter === 'mine' ? (
                    <>
                      <Laptop className="w-8 h-8 text-indigo-500" />
                      <span className="font-extrabold text-gray-800">Nessuna postazione in uso</span>
                      <p className="text-xs text-gray-400 max-w-sm leading-relaxed">
                        Al momento non hai preso in carico nessuna postazione PC CAD. Clicca su "Tutte" o "Solo Disponibili" per visualizzare i PC da prenotare.
                      </p>
                    </>
                  ) : (
                    <>
                      <Info className="w-8 h-8 text-amber-500" />
                      <span className="font-extrabold text-gray-800">Nessuna postazione disponibile</span>
                      <p className="text-xs text-gray-400 max-w-sm leading-relaxed">
                        Tutte le macchine virtuali o le licenze sono attualmente occupate. Disattiva il filtro per visualizzare tutte le postazioni.
                      </p>
                    </>
                  )}
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

                  {/* Sezione Postazioni Singole */}
                  {aecGroups.ltPcs.length > 0 && (
                    <div className="space-y-6">
                      <div className="border-b border-gray-100 pb-2">
                        <h2 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                          <Laptop className="w-5 h-5 text-teal-600" />
                          <span>Postazioni singole</span>
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

      {/* --- TAB 2: CHIAVETTE & LICENZE SOFTWARE --- */}
      {activeTab === 'software_keys' && (
        <div className="space-y-6 animate-in fade-in">
          {/* Note informative / Istruzioni compatte */}
          <div className="bg-indigo-50/70 border border-indigo-100 rounded-3xl p-5 text-indigo-900 text-xs flex items-start gap-3 shadow-sm">
            <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-extrabold text-sm text-indigo-950 mb-0.5">Gestione e Prenotazione Chiavette & Licenze Software</div>
              <p className="leading-relaxed font-medium">
                La tabella sottostante indica la disponibilità in tempo reale delle licenze e chiavette USB (EdiLus, PriMus, TerMus, Solarius). Clicca su <strong>"Prendi in uso"</strong> prima di utilizzare il programma sul tuo computer e ricordati di cliccare <strong>"Rilascia"</strong> non appena hai completato il lavoro per consentire l'utilizzo ai tuoi colleghi.
              </p>
            </div>
          </div>

          {/* Tabella Chiavette e Licenze ACCA */}
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-md border border-white/50 p-6 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-medium text-gray-600">
                <thead>
                  <tr className="border-b border-gray-150 text-gray-400 font-extrabold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4 text-center">Stato</th>
                    <th className="py-3 px-4">Programma</th>
                    <th className="py-3 px-4">Tipo Licenza</th>
                    <th className="py-3 px-4">Utilizzatore</th>
                    <th className="py-3 px-4">Versione Software</th>
                    <th className="py-3 px-4">Servizi Attivi</th>
                    <th className="py-3 px-4">Numero di Serie</th>
                    <th className="py-3 px-4 text-center">Azione</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {softwareKeysList.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-400 font-bold italic">
                        Nessuna licenza software censita.
                      </td>
                    </tr>
                  ) : (
                    softwareKeysList.map(keyRes => {
                      const isOccupied = keyRes.statoCorrente?.occupato;
                      const isMe = keyRes.statoCorrente?.utilizzatoreEmail?.toLowerCase() === currentUserEmail?.toLowerCase();
                      const canForce = (isDev || isAdmin) && isOccupied && !isMe;

                      return (
                        <tr 
                          key={keyRes.docId || keyRes.id} 
                          className={`transition ${
                            isOccupied
                              ? isMe
                                ? 'bg-indigo-50/60 hover:bg-indigo-50/80 font-semibold'
                                : 'bg-rose-50/50 hover:bg-rose-50/70'
                              : 'hover:bg-gray-50/70'
                          }`}
                        >
                          {/* 1. STATO */}
                          <td className="py-4 px-4 text-center whitespace-nowrap">
                            <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider inline-block ${
                              isOccupied
                                ? isMe
                                  ? 'bg-indigo-600 text-white shadow-sm'
                                  : 'bg-rose-600 text-white shadow-sm'
                                : 'bg-emerald-600 text-white shadow-sm'
                            }`}>
                              {isOccupied ? (isMe ? 'IN USO (TU)' : 'IN USO') : 'DISPONIBILE'}
                            </span>
                          </td>

                          {/* 2. PROGRAMMA */}
                          <td className="py-4 px-4 font-black text-gray-900 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <div className={`p-1.5 rounded-lg ${
                                keyRes.dettagli.programma?.toUpperCase().includes('PRIMUS') ? 'bg-amber-100 text-amber-800' :
                                keyRes.dettagli.programma?.toUpperCase().includes('TERMUS') ? 'bg-orange-100 text-orange-800' :
                                keyRes.dettagli.programma?.toUpperCase().includes('EDILUS') ? 'bg-blue-100 text-blue-800' :
                                'bg-emerald-100 text-emerald-800'
                              }`}>
                                <KeyRound className="w-4 h-4" />
                              </div>
                              <span className="text-sm font-extrabold">{keyRes.dettagli.programma || keyRes.nome}</span>
                            </div>
                          </td>

                          {/* 3. TIPO LICENZA */}
                          <td className="py-4 px-4 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-700 font-bold px-2.5 py-1 rounded-lg text-xs">
                              {keyRes.dettagli.tipoLicenza?.toLowerCase().includes('usb') && <Usb className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                              {keyRes.dettagli.tipoLicenza || 'Standard'}
                            </span>
                          </td>

                          {/* 4. UTILIZZATORE */}
                          <td className="py-4 px-4">
                            {isOccupied ? (
                              <div className="flex flex-col gap-0.5">
                                <div className="font-extrabold text-gray-900 flex items-center gap-1.5">
                                  <span>{keyRes.statoCorrente?.utilizzatoreNome || 'Utente'}</span>
                                  {isMe && (
                                    <span className="bg-indigo-600 text-white text-[9px] font-black px-1.5 py-0.2 rounded-full uppercase">Tu</span>
                                  )}
                                </div>
                                {keyRes.statoCorrente?.dataInizioUso && (
                                  <span className="text-[10px] text-gray-400 font-medium">
                                    Da: {formatDateTime(keyRes.statoCorrente?.dataInizioUso)}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-400 italic text-xs">Libera</span>
                            )}
                          </td>

                          {/* 5. VERSIONE SOFTWARE */}
                          <td className="py-4 px-4 font-semibold text-gray-750">
                            <span className="block max-w-[260px] truncate" title={keyRes.dettagli.versioneSoftware}>
                              {keyRes.dettagli.versioneSoftware || '-'}
                            </span>
                          </td>

                          {/* 6. SERVIZI ATTIVI */}
                          <td className="py-4 px-4 font-bold text-gray-700 whitespace-nowrap">
                            {keyRes.dettagli.serviziAttivi && keyRes.dettagli.serviziAttivi !== '-' ? (
                              <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded text-[10px] font-bold">
                                {keyRes.dettagli.serviziAttivi}
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>

                          {/* 7. NUMERO DI SERIE */}
                          <td className="py-4 px-4 font-mono font-bold text-gray-800 whitespace-nowrap">
                            <span className="bg-gray-100 px-2.5 py-1 rounded-lg select-all text-xs border border-gray-200">
                              {keyRes.dettagli.numeroSerie || '-'}
                            </span>
                          </td>

                          {/* 8. AZIONI */}
                          <td className="py-4 px-4 text-center whitespace-nowrap">
                            {!isOccupied ? (
                              <button
                                onClick={() => handleClaimSoftwareKey(keyRes)}
                                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition text-xs shadow-sm flex items-center gap-1.5 mx-auto cursor-pointer active:scale-95"
                              >
                                <Check className="w-3.5 h-3.5" /> Prendi in uso
                              </button>
                            ) : isMe ? (
                              <button
                                onClick={() => handleReleaseSoftwareKey(keyRes, false)}
                                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl transition text-xs shadow-sm flex items-center gap-1.5 mx-auto cursor-pointer active:scale-95"
                              >
                                <X className="w-3.5 h-3.5" /> Rilascia
                              </button>
                            ) : canForce ? (
                              <button
                                onClick={() => handleReleaseSoftwareKey(keyRes, true)}
                                className="px-2.5 py-1 border border-rose-200 text-rose-600 hover:bg-rose-50 font-bold rounded-lg transition text-[11px] mx-auto cursor-pointer"
                                title="Forza il rilascio della licenza"
                              >
                                Forza Rilascio
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400 font-semibold italic">In uso</span>
                            )}
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

      {/* --- TAB 3: SALE RIUNIONI --- */}
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

      {/* --- TAB 4: AMMINISTRAZIONE / GESTIONE RISORSE (SOLO SVILUPPATORE) --- */}
      {activeTab === 'admin' && isDev && (
        <div className="space-y-6 animate-in fade-in">
          {/* Header Gestione Sviluppatore */}
          <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-red-600" />
                <span>Pannello Risorse & Configurazione (Sviluppatore)</span>
              </h3>
              <p className="text-xs font-bold text-gray-500 mt-1">
                Gestione separata delle anagrafiche hardware/software e dei limiti licenze per l'intero ambiente aziendale.
              </p>
            </div>

            {/* Sottosezioni / Switcher */}
            <div className="flex bg-gray-100 p-1 rounded-xl gap-1 flex-wrap">
              <button
                type="button"
                onClick={() => setAdminActiveSubSection('pc')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  adminActiveSubSection === 'pc' ? 'bg-white text-teal-700 shadow-xs' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Laptop className="w-3.5 h-3.5" /> Postazioni PC
              </button>
              <button
                type="button"
                onClick={() => setAdminActiveSubSection('software_key')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  adminActiveSubSection === 'software_key' ? 'bg-white text-indigo-700 shadow-xs' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" /> Licenze Software
              </button>
              <button
                type="button"
                onClick={() => setAdminActiveSubSection('room')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  adminActiveSubSection === 'room' ? 'bg-white text-indigo-700 shadow-xs' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <CalendarDays className="w-3.5 h-3.5" /> Sale
              </button>
              <button
                type="button"
                onClick={() => setAdminActiveSubSection('car')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  adminActiveSubSection === 'car' ? 'bg-white text-teal-700 shadow-xs' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Car className="w-3.5 h-3.5" /> Auto
              </button>
              <button
                type="button"
                onClick={() => setAdminActiveSubSection('licenses')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  adminActiveSubSection === 'licenses' ? 'bg-white text-indigo-700 shadow-xs' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" /> Limiti Autodesk
              </button>
            </div>
          </div>

          {/* SOTTOSEZIONE 1: POSTAZIONI PC CAD */}
          {adminActiveSubSection === 'pc' && (
            <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50 space-y-4">
              <div className="flex justify-between items-center flex-wrap gap-3 border-b border-gray-100 pb-3">
                <div>
                  <h4 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                    <Laptop className="w-4 h-4 text-teal-600" />
                    <span>Postazioni CAD Remoti ({pcsList.length})</span>
                  </h4>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Gestione delle postazioni RDP e delle licenze Autodesk associate.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
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
                      targa: '',
                      programma: 'EDILUS',
                      tipoLicenza: 'chiavetta USB',
                      versioneSoftware: '',
                      serviziAttivi: '',
                      numeroSerie: ''
                    });
                    setIsAdminAddResourceOpen(true);
                  }}
                  className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-3.5 rounded-xl text-xs shadow flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Aggiungi Postazione PC
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-medium text-gray-600">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-3">Identificativo</th>
                      <th className="py-3 px-3">IP</th>
                      <th className="py-3 px-3">Utente RDP</th>
                      <th className="py-3 px-3">Licenza Autodesk</th>
                      <th className="py-3 px-3">Sede</th>
                      <th className="py-3 px-3">Programmi Extra</th>
                      <th className="py-3 px-3 text-center">Azioni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {pcsList.length === 0 ? (
                      <tr><td colSpan={7} className="py-6 text-center text-gray-400 font-bold italic">Nessun PC registrato.</td></tr>
                    ) : (
                      pcsList.map(res => (
                        <tr key={res.docId || res.id} className="hover:bg-gray-50/50 transition">
                          <td className="py-3 px-3 font-black text-gray-900">{res.id}</td>
                          <td className="py-3 px-3 font-mono font-bold text-gray-700">{res.dettagli.ipAddress || '-'}</td>
                          <td className="py-3 px-3 font-bold text-gray-800">{res.dettagli.utenteIngegno || '-'}</td>
                          <td className="py-3 px-3">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-md uppercase ${
                              res.dettagli.licenzaAutodesk === 'Autocad LT' ? 'bg-cyan-100 text-cyan-800' : 'bg-indigo-100 text-indigo-800'
                            }`}>
                              {res.dettagli.licenzaAutodesk || 'Nessuna'}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-medium text-gray-600">{res.dettagli.sede || '-'}</td>
                          <td className="py-3 px-3 font-medium text-gray-500 max-w-[200px] truncate">{res.dettagli.programmiInstallati || '-'}</td>
                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleOpenEditResource(res)}
                                className="text-gray-400 hover:text-indigo-600 p-1.5 rounded-xl hover:bg-indigo-50 transition cursor-pointer"
                                title="Modifica"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteResource(res)}
                                className="text-gray-400 hover:text-red-600 p-1.5 rounded-xl hover:bg-red-50 transition cursor-pointer"
                                title="Elimina"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SOTTOSEZIONE 2: CHIAVETTE & LICENZE SOFTWARE */}
          {adminActiveSubSection === 'software_key' && (
            <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50 space-y-4">
              <div className="flex justify-between items-center flex-wrap gap-3 border-b border-gray-100 pb-3">
                <div>
                  <h4 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-indigo-600" />
                    <span>Chiavette & Licenze Software ({softwareKeysList.length})</span>
                  </h4>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Gestione delle chiavette USB fisiche e delle licenze software addizionali (EdiLus, PriMus, TerMus, Solarius).</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      triggerConfirm(
                        "Ripristina Licenze ACCA da Excel",
                        "Vuoi ripristinare / caricare le 7 licenze ACCA standard configurate nel file Excel?",
                        handleSeedDefaultSoftwareKeys
                      );
                    }}
                    className="bg-gray-100 hover:bg-gray-200 text-gray-750 font-bold py-2 px-3.5 rounded-xl text-xs transition cursor-pointer"
                  >
                    ↺ Reinizializza 7 Licenze ACCA
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewResourceData({
                        id: '',
                        nome: '',
                        tipo: 'software_key',
                        utenteIngegno: '',
                        pswUtente: '',
                        licenzaAutodesk: 'AEC Collection',
                        programmiInstallati: '',
                        ipAddress: '',
                        sede: 'Via Diaz',
                        modello: '',
                        targa: '',
                        programma: 'EDILUS',
                        tipoLicenza: 'chiavetta USB',
                        versioneSoftware: '',
                        serviziAttivi: '',
                        numeroSerie: ''
                      });
                      setIsAdminAddResourceOpen(true);
                    }}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-3.5 rounded-xl text-xs shadow flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" /> Aggiungi Chiavetta / Licenza
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-medium text-gray-600">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-3">Programma</th>
                      <th className="py-3 px-3">Tipo Licenza</th>
                      <th className="py-3 px-3">Versione Software</th>
                      <th className="py-3 px-3">Servizi Attivi</th>
                      <th className="py-3 px-3">Numero di Serie</th>
                      <th className="py-3 px-3 text-center">Azioni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {softwareKeysList.length === 0 ? (
                      <tr><td colSpan={6} className="py-6 text-center text-gray-400 font-bold italic">Nessuna licenza software registrata. Premi "Reinizializza 7 Licenze ACCA" in alto.</td></tr>
                    ) : (
                      softwareKeysList.map(res => (
                        <tr key={res.docId || res.id} className="hover:bg-gray-50/50 transition">
                          <td className="py-3 px-3 font-black text-gray-900">
                            <div className="flex items-center gap-1.5">
                              <KeyRound className="w-3.5 h-3.5 text-indigo-600" />
                              <span>{res.dettagli.programma || res.nome}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 font-bold text-gray-700">
                            <span className="bg-gray-100 px-2 py-0.5 rounded text-[11px] font-bold">
                              {res.dettagli.tipoLicenza || '-'}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-medium text-gray-700 max-w-[220px] truncate" title={res.dettagli.versioneSoftware}>
                            {res.dettagli.versioneSoftware || '-'}
                          </td>
                          <td className="py-3 px-3 font-bold text-gray-700">{res.dettagli.serviziAttivi || '-'}</td>
                          <td className="py-3 px-3 font-mono font-bold text-gray-800">{res.dettagli.numeroSerie || '-'}</td>
                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleOpenEditResource(res)}
                                className="text-gray-400 hover:text-indigo-600 p-1.5 rounded-xl hover:bg-indigo-50 transition cursor-pointer"
                                title="Modifica"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteResource(res)}
                                className="text-gray-400 hover:text-red-600 p-1.5 rounded-xl hover:bg-red-50 transition cursor-pointer"
                                title="Elimina"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SOTTOSEZIONE 3: SALE RIUNIONI */}
          {adminActiveSubSection === 'room' && (
            <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50 space-y-4">
              <div className="flex justify-between items-center flex-wrap gap-3 border-b border-gray-100 pb-3">
                <div>
                  <h4 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-indigo-600" />
                    <span>Sale Riunioni ({roomsList.length})</span>
                  </h4>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Gestione delle sale prenotabili per meeting e incontri con clienti.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewResourceData({
                      id: '',
                      nome: '',
                      tipo: 'room',
                      utenteIngegno: '',
                      pswUtente: '',
                      licenzaAutodesk: 'AEC Collection',
                      programmiInstallati: '',
                      ipAddress: '',
                      sede: 'Via Diaz',
                      modello: '',
                      targa: '',
                      programma: 'EDILUS',
                      tipoLicenza: 'chiavetta USB',
                      versioneSoftware: '',
                      serviziAttivi: '',
                      numeroSerie: ''
                    });
                    setIsAdminAddResourceOpen(true);
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-3.5 rounded-xl text-xs shadow flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Aggiungi Sala
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-medium text-gray-600">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-3">Identificativo</th>
                      <th className="py-3 px-3">Nome Sala</th>
                      <th className="py-3 px-3">Sede</th>
                      <th className="py-3 px-3 text-center">Azioni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {roomsList.length === 0 ? (
                      <tr><td colSpan={4} className="py-6 text-center text-gray-400 font-bold italic">Nessuna sala registrata.</td></tr>
                    ) : (
                      roomsList.map(res => (
                        <tr key={res.docId || res.id} className="hover:bg-gray-50/50 transition">
                          <td className="py-3 px-3 font-black text-gray-900">{res.id}</td>
                          <td className="py-3 px-3 font-bold text-gray-800">{res.nome}</td>
                          <td className="py-3 px-3 font-medium text-gray-600">{res.dettagli.sede || '-'}</td>
                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleOpenEditResource(res)}
                                className="text-gray-400 hover:text-indigo-600 p-1.5 rounded-xl hover:bg-indigo-50 transition cursor-pointer"
                                title="Modifica"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteResource(res)}
                                className="text-gray-400 hover:text-red-600 p-1.5 rounded-xl hover:bg-red-50 transition cursor-pointer"
                                title="Elimina"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SOTTOSEZIONE 4: AUTO AZIENDALI */}
          {adminActiveSubSection === 'car' && (
            <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50 space-y-4">
              <div className="flex justify-between items-center flex-wrap gap-3 border-b border-gray-100 pb-3">
                <div>
                  <h4 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                    <Car className="w-4 h-4 text-teal-600" />
                    <span>Auto Aziendali ({carsList.length})</span>
                  </h4>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">Gestione delle autovetture del parco aziendale per trasferte e cantieri.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewResourceData({
                      id: '',
                      nome: '',
                      tipo: 'car',
                      utenteIngegno: '',
                      pswUtente: '',
                      licenzaAutodesk: 'AEC Collection',
                      programmiInstallati: '',
                      ipAddress: '',
                      sede: 'Via Diaz',
                      modello: '',
                      targa: '',
                      programma: 'EDILUS',
                      tipoLicenza: 'chiavetta USB',
                      versioneSoftware: '',
                      serviziAttivi: '',
                      numeroSerie: ''
                    });
                    setIsAdminAddResourceOpen(true);
                  }}
                  className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-3.5 rounded-xl text-xs shadow flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Aggiungi Auto
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-medium text-gray-600">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 font-extrabold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-3">Identificativo</th>
                      <th className="py-3 px-3">Nome Display</th>
                      <th className="py-3 px-3">Modello</th>
                      <th className="py-3 px-3">Targa</th>
                      <th className="py-3 px-3">Sede</th>
                      <th className="py-3 px-3 text-center">Azioni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {carsList.length === 0 ? (
                      <tr><td colSpan={6} className="py-6 text-center text-gray-400 font-bold italic">Nessun'auto registrata.</td></tr>
                    ) : (
                      carsList.map(res => (
                        <tr key={res.docId || res.id} className="hover:bg-gray-50/50 transition">
                          <td className="py-3 px-3 font-black text-gray-900">{res.id}</td>
                          <td className="py-3 px-3 font-bold text-gray-800">{res.nome}</td>
                          <td className="py-3 px-3 font-medium text-gray-700">{res.dettagli.modello || '-'}</td>
                          <td className="py-3 px-3 font-mono font-bold text-gray-900 uppercase">{res.dettagli.targa || '-'}</td>
                          <td className="py-3 px-3 font-medium text-gray-600">{res.dettagli.sede || '-'}</td>
                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleOpenEditResource(res)}
                                className="text-gray-400 hover:text-indigo-600 p-1.5 rounded-xl hover:bg-indigo-50 transition cursor-pointer"
                                title="Modifica"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteResource(res)}
                                className="text-gray-400 hover:text-red-600 p-1.5 rounded-xl hover:bg-red-50 transition cursor-pointer"
                                title="Elimina"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SOTTOSEZIONE 5: LIMITI LICENZE AUTODESK */}
          {adminActiveSubSection === 'licenses' && (
            <div className="bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] shadow-md border border-white/50 space-y-4">
              <div>
                <h4 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                  <Laptop className="w-4 h-4 text-indigo-600" />
                  <span>Configura Limiti Licenze Autodesk Globali</span>
                </h4>
                <p className="text-xs text-gray-500 font-medium mt-0.5">
                  Imposta il limite massimo di licenze simultanee della ditta da monitorare nei cruscotti di allerta.
                </p>
              </div>

              <form onSubmit={handleSaveLicenseLimits} className="flex flex-col gap-4 max-w-xl">
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
                <div>
                  <button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-xl text-xs shadow transition active:scale-95 whitespace-nowrap"
                  >
                    Salva Limiti Licenze
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* --- MODALS SECTION --- */}

      {/* 1. Modal Claim PC */}
      {isClaimPCModalOpen && selectedPC && (() => {
        const twinStatus = getTwinStatus(selectedPC);
        const isSingle = selectedPC.dettagli.licenzaAutodesk === 'Autocad LT' || !twinStatus.hasTwins;
        const bothLicensesOnTwin = twinStatus.hasTwins && twinStatus.isTwinRevitInUse && twinStatus.isTwinAutocadInUse;

        return (
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
            <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full border border-gray-100 p-6 flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                  <Laptop className="w-5 h-5 text-teal-600" />
                  <span>Prendi in uso {selectedPC.id}</span>
                </h3>
                <button 
                  onClick={() => setIsClaimPCModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleClaimPCSubmit} className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-2xl text-xs space-y-1.5 font-medium text-gray-600 border border-gray-100">
                  <div className="font-extrabold text-gray-800 text-sm mb-1 flex items-center gap-1.5">
                    <Laptop className="w-4 h-4 text-teal-600" />
                    <span>Dettagli Desktop Remoto:</span>
                  </div>
                  <div>IP: <span className="font-bold text-gray-900 bg-white px-1.5 py-0.5 rounded border border-gray-200">{selectedPC.dettagli.ipAddress || '-'}</span></div>
                  <div>Credenziali: <span className="font-bold text-gray-900">{selectedPC.dettagli.utenteIngegno}</span> / <span className="font-bold text-gray-900 select-all bg-white px-1.5 py-0.5 rounded border border-gray-200">{selectedPC.dettagli.pswUtente}</span></div>
                  <div className="pt-2 text-[11px] text-teal-700 font-bold flex items-center gap-1">
                    <span>🚀 Alla conferma verrà avviata automaticamente la sessione di Desktop Remoto.</span>
                  </div>
                </div>

                {isSingle ? (
                  <div className="p-3.5 bg-teal-50/70 border border-teal-100 rounded-xl text-teal-950 text-xs font-semibold">
                    <span>💡 Postazione singola con licenza dedicata locale. Nessuna condivisione con altre macchine.</span>
                  </div>
                ) : (
                  <div className="space-y-2 border-t border-gray-100 pt-3">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Utilizzo Licenze Autodesk</label>
                    
                    {bothLicensesOnTwin && (
                      <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs font-bold mb-2">
                        ⚠️ Le licenze Revit e AutoCAD sono attualmente in uso sul PC gemello. Puoi comunque confermare per utilizzare gli altri software installati sulla macchina.
                      </div>
                    )}

                    <label className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer select-none ${
                      twinStatus.isTwinRevitInUse 
                        ? 'bg-gray-100 border-gray-200 text-gray-450 cursor-not-allowed opacity-60' 
                        : 'bg-gray-50 hover:bg-gray-100/70 border-transparent text-gray-800'
                    }`}>
                      <input
                        type="checkbox"
                        checked={useRevit}
                        disabled={twinStatus.isTwinRevitInUse}
                        onChange={e => setUseRevit(e.target.checked)}
                        className={`w-4.5 h-4.5 text-teal-600 rounded border-gray-300 focus:ring-teal-500 ${
                          twinStatus.isTwinRevitInUse ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                        }`}
                      />
                      <div>
                        <div className="text-xs font-extrabold flex items-center gap-2">
                          <span>Licenza Revit</span>
                          {twinStatus.isTwinRevitInUse && (
                            <span className="text-rose-600 font-extrabold text-[9px] uppercase bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">
                              In uso sul gemello
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-400">Occupa uno slot delle licenze Revit della ditta</div>
                      </div>
                    </label>

                    <label className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer select-none ${
                      twinStatus.isTwinAutocadInUse 
                        ? 'bg-gray-100 border-gray-200 text-gray-450 cursor-not-allowed opacity-60' 
                        : 'bg-gray-50 hover:bg-gray-100/70 border-transparent text-gray-800'
                    }`}>
                      <input
                        type="checkbox"
                        checked={useAutoCAD}
                        disabled={twinStatus.isTwinAutocadInUse}
                        onChange={e => setUseAutoCAD(e.target.checked)}
                        className={`w-4.5 h-4.5 text-teal-600 rounded border-gray-300 focus:ring-teal-500 ${
                          twinStatus.isTwinAutocadInUse ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                        }`}
                      />
                      <div>
                        <div className="text-xs font-extrabold flex items-center gap-2">
                          <span>Licenza AutoCAD</span>
                          {twinStatus.isTwinAutocadInUse && (
                            <span className="text-rose-600 font-extrabold text-[9px] uppercase bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">
                              In uso sul gemello
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-400">Occupa uno slot delle licenze AutoCAD della ditta</div>
                      </div>
                    </label>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsClaimPCModalOpen(false)}
                    className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
                  >
                    Annulla
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 px-4 rounded-xl bg-teal-600 text-white text-xs font-bold hover:bg-teal-700 transition active:scale-95 shadow cursor-pointer"
                  >
                    Conferma Collegamento
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* 1b. Modal Edit PC Licenses */}
      {isEditPCModalOpen && selectedPC && (() => {
        const twinStatus = getTwinStatus(selectedPC);
        const bothLicensesOnTwin = twinStatus.hasTwins && twinStatus.isTwinRevitInUse && twinStatus.isTwinAutocadInUse;

        return (
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
            <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full border border-gray-100 p-6 flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                  <RefreshCw className="w-5 h-5 text-indigo-600" />
                  <span>Modifica Licenze {selectedPC.id}</span>
                </h3>
                <button 
                  onClick={() => setIsEditPCModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition cursor-pointer"
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
                  
                  {bothLicensesOnTwin && (
                    <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs font-bold mb-2">
                      ⚠️ Le licenze Revit e AutoCAD sono attualmente in uso sul PC gemello.
                    </div>
                  )}

                  <label className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer select-none ${
                    twinStatus.isTwinRevitInUse 
                      ? 'bg-gray-100 border-gray-200 text-gray-455 cursor-not-allowed opacity-60' 
                      : 'bg-gray-50 hover:bg-gray-100/70 border-transparent text-gray-800'
                  }`}>
                    <input
                      type="checkbox"
                      checked={useRevit}
                      disabled={twinStatus.isTwinRevitInUse}
                      onChange={e => setUseRevit(e.target.checked)}
                      className={`w-4.5 h-4.5 text-teal-600 rounded border-gray-300 focus:ring-teal-500 ${
                        twinStatus.isTwinRevitInUse ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    />
                    <div>
                      <div className="text-xs font-extrabold flex items-center gap-2">
                        <span>Licenza Revit</span>
                        {twinStatus.isTwinRevitInUse && (
                          <span className="text-rose-600 font-extrabold text-[9px] uppercase bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">
                            In uso sul gemello
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400">Occupa uno slot delle licenze Revit della ditta</div>
                    </div>
                  </label>

                  <label className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer select-none ${
                    twinStatus.isTwinAutocadInUse 
                      ? 'bg-gray-100 border-gray-200 text-gray-455 cursor-not-allowed opacity-60' 
                      : 'bg-gray-50 hover:bg-gray-100/70 border-transparent text-gray-800'
                  }`}>
                    <input
                      type="checkbox"
                      checked={useAutoCAD}
                      disabled={twinStatus.isTwinAutocadInUse}
                      onChange={e => setUseAutoCAD(e.target.checked)}
                      className={`w-4.5 h-4.5 text-teal-600 rounded border-gray-300 focus:ring-teal-500 ${
                        twinStatus.isTwinAutocadInUse ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    />
                    <div>
                      <div className="text-xs font-extrabold flex items-center gap-2">
                        <span>Licenza AutoCAD</span>
                        {twinStatus.isTwinAutocadInUse && (
                          <span className="text-rose-600 font-extrabold text-[9px] uppercase bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">
                            In uso sul gemello
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400">Occupa uno slot delle licenze AutoCAD della ditta</div>
                    </div>
                  </label>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsEditPCModalOpen(false)}
                    className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
                  >
                    Annulla
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 px-4 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition active:scale-95 shadow cursor-pointer"
                  >
                    Salva Modifiche
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* 2. Modal Car Check-In */}
      {isCarCheckInModalOpen && selectedCarBooking && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full border border-gray-100 p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Car className="w-5 h-5 text-emerald-600" />
                <span>Prendi in consegna auto</span>
              </h3>
              <button onClick={() => setIsCarCheckInModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer">
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
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition cursor-pointer"
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
              <button onClick={() => setIsCarCheckOutModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer">
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
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition cursor-pointer"
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
              <button onClick={() => setIsAdminAddResourceOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddResourceSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Tipo Risorsa</label>
                <select
                  value={newResourceData.tipo}
                  onChange={e => setNewResourceData(prev => ({ ...prev, tipo: e.target.value as 'pc' | 'room' | 'car' | 'software_key' }))}
                  className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                >
                  <option value="pc">Postazione CAD (PC Remoto)</option>
                  <option value="software_key">Chiavetta / Licenza Software ACCA</option>
                  <option value="room">Sala Riunioni</option>
                  <option value="car">Autovettura Aziendale</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Identificativo Risorsa (ID unico, es. KEY_EDILUS_USB, ING_WSN_20)</label>
                <input
                  required
                  type="text"
                  placeholder="Es. KEY_EDILUS_USB o ING_WSN_20"
                  value={newResourceData.id}
                  onChange={e => setNewResourceData(prev => ({ ...prev, id: e.target.value }))}
                  className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Nome Display (es. EdiLus Chiavetta, Sala Diaz)</label>
                <input
                  required
                  type="text"
                  placeholder="Es. EdiLus (Chiavetta USB) o Sala Diaz"
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

              {/* Software Key Specific Details */}
              {newResourceData.tipo === 'software_key' && (
                <div className="space-y-4 border-t border-gray-100 pt-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Programma</label>
                    <select
                      value={newResourceData.programma}
                      onChange={e => setNewResourceData(prev => ({ ...prev, programma: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    >
                      <option value="EDILUS">EDILUS</option>
                      <option value="PRIMUS">PRIMUS</option>
                      <option value="SOLARIUS">SOLARIUS</option>
                      <option value="TERMUS">TERMUS</option>
                      <option value="ALTRO">ALTRO SOFTWARE</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Tipo Licenza</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. chiavetta USB o 2° licenza senza USB"
                      value={newResourceData.tipoLicenza}
                      onChange={e => setNewResourceData(prev => ({ ...prev, tipoLicenza: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Versione Software</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. PriMus usBIM (PowerPack) o TerMus BIM + E 52.00"
                      value={newResourceData.versioneSoftware}
                      onChange={e => setNewResourceData(prev => ({ ...prev, versioneSoftware: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Servizi Attivi</label>
                    <input
                      type="text"
                      placeholder="Es. AmicUS o POWER PACK"
                      value={newResourceData.serviziAttivi}
                      onChange={e => setNewResourceData(prev => ({ ...prev, serviziAttivi: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Numero di Serie / ID Licenza</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. 20020677 o 13041419"
                      value={newResourceData.numeroSerie}
                      onChange={e => setNewResourceData(prev => ({ ...prev, numeroSerie: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none font-mono"
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
                  className="flex-1 py-3.5 px-4 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3.5 px-4 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition active:scale-95 shadow cursor-pointer"
                >
                  Salva Risorsa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Admin Edit Resource Modal */}
      {isAdminEditResourceOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-md w-full border border-gray-100 p-8 flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-200 overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <Pencil className="w-5 h-5 text-indigo-600" />
                <span>Modifica Risorsa ({editResourceData.id})</span>
              </h3>
              <button onClick={() => setIsAdminEditResourceOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditResourceSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Tipo Risorsa</label>
                <select
                  disabled
                  value={editResourceData.tipo}
                  className="w-full p-3 text-sm border-none rounded-xl bg-gray-100 font-bold text-gray-700 outline-none cursor-not-allowed"
                >
                  <option value="pc">Postazione CAD (PC Remoto)</option>
                  <option value="software_key">Chiavetta / Licenza Software ACCA</option>
                  <option value="room">Sala Riunioni</option>
                  <option value="car">Autovettura Aziendale</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Identificativo Risorsa (ID)</label>
                <input
                  required
                  type="text"
                  value={editResourceData.id}
                  onChange={e => setEditResourceData(prev => ({ ...prev, id: e.target.value }))}
                  className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Nome Display</label>
                <input
                  required
                  type="text"
                  value={editResourceData.nome}
                  onChange={e => setEditResourceData(prev => ({ ...prev, nome: e.target.value }))}
                  className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                />
              </div>

              {/* PC Specific Details */}
              {editResourceData.tipo === 'pc' && (
                <div className="space-y-4 border-t border-gray-100 pt-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Utente Windows RDP</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. disegnatore01"
                      value={editResourceData.utenteIngegno}
                      onChange={e => setEditResourceData(prev => ({ ...prev, utenteIngegno: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Password Windows RDP</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. Ingegnocad*01"
                      value={editResourceData.pswUtente}
                      onChange={e => setEditResourceData(prev => ({ ...prev, pswUtente: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Tipo Licenza Autodesk Base</label>
                    <select
                      value={editResourceData.licenzaAutodesk}
                      onChange={e => setEditResourceData(prev => ({ ...prev, licenzaAutodesk: e.target.value }))}
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
                      value={editResourceData.ipAddress}
                      onChange={e => setEditResourceData(prev => ({ ...prev, ipAddress: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1 ml-1">
                      Programmi Installati su questo PC
                    </label>
                    <span className="block text-[10px] text-gray-400 font-medium mb-1.5 ml-1">
                      Separati da virgola (es. Revit 2025, AutoCAD 2026, Edilclima, Photoshop, Primus, SAP2000)
                    </span>
                    <textarea
                      rows={3}
                      placeholder="Es. Revit 2025, AutoCAD 2026, Edilclima, Photoshop"
                      value={editResourceData.programmiInstallati}
                      onChange={e => setEditResourceData(prev => ({ ...prev, programmiInstallati: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none resize-none"
                    />
                  </div>
                </div>
              )}

              {/* Software Key Specific Details */}
              {editResourceData.tipo === 'software_key' && (
                <div className="space-y-4 border-t border-gray-100 pt-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Programma</label>
                    <select
                      value={editResourceData.programma}
                      onChange={e => setEditResourceData(prev => ({ ...prev, programma: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    >
                      <option value="EDILUS">EDILUS</option>
                      <option value="PRIMUS">PRIMUS</option>
                      <option value="SOLARIUS">SOLARIUS</option>
                      <option value="TERMUS">TERMUS</option>
                      <option value="ALTRO">ALTRO SOFTWARE</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Tipo Licenza</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. chiavetta USB o 2° licenza senza USB"
                      value={editResourceData.tipoLicenza}
                      onChange={e => setEditResourceData(prev => ({ ...prev, tipoLicenza: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Versione Software</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. PriMus usBIM (PowerPack) o TerMus BIM + E 52.00"
                      value={editResourceData.versioneSoftware}
                      onChange={e => setEditResourceData(prev => ({ ...prev, versioneSoftware: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Servizi Attivi</label>
                    <input
                      type="text"
                      placeholder="Es. AmicUS o POWER PACK"
                      value={editResourceData.serviziAttivi}
                      onChange={e => setEditResourceData(prev => ({ ...prev, serviziAttivi: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Numero di Serie / ID Licenza</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. 20020677 o 13041419"
                      value={editResourceData.numeroSerie}
                      onChange={e => setEditResourceData(prev => ({ ...prev, numeroSerie: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Room Specific Details */}
              {editResourceData.tipo === 'room' && (
                <div className="space-y-4 border-t border-gray-100 pt-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Sede della Sala</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. Via Diaz o Via Gramsci"
                      value={editResourceData.sede}
                      onChange={e => setEditResourceData(prev => ({ ...prev, sede: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Car Specific Details */}
              {editResourceData.tipo === 'car' && (
                <div className="space-y-4 border-t border-gray-100 pt-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Modello Auto</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. Citroen C3"
                      value={editResourceData.modello}
                      onChange={e => setEditResourceData(prev => ({ ...prev, modello: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Targa Autoveicolo</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. AB123CD"
                      value={editResourceData.targa}
                      onChange={e => setEditResourceData(prev => ({ ...prev, targa: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Sede di Parcheggio Auto</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. Via Diaz"
                      value={editResourceData.sede}
                      onChange={e => setEditResourceData(prev => ({ ...prev, sede: e.target.value }))}
                      className="w-full p-3 text-sm border-none rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700 outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAdminEditResourceOpen(false)}
                  className="flex-1 py-3.5 px-4 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3.5 px-4 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition active:scale-95 shadow cursor-pointer"
                >
                  Aggiorna Risorsa
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
