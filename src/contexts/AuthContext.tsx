import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from 'react';
import { type User, onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, query, where, onSnapshot, documentId } from 'firebase/firestore';
import { auth, db } from '../services/firebase';

const DEFAULT_ADMINS = ['aprofeti@ingegno06.it', 'mcorbellini@ingegno06.it'];

export interface Dipendente {
  id: string;
  nome: string;
  email: string;
  tipo?: 'dipendente' | 'collaboratore';
  dailyRate?: number;
  inpsRate?: number;
  ivaRate?: number;
  raRate?: number;
  oreContratto?: number;
  importoFissoMensile?: number;
  macroArea?: 'Disegnatori' | 'Ingegneria' | 'Sicurezza Cantieri' | 'Consulenza Sicurezza' | 'Amministrazione';
  dataCessazione?: string;
  dataNascita?: string;
  orarioSettimanale?: { lun: number; mar: number; mer: number; gio: number; ven: number };
  notificheEmail?: boolean;
}

export function isTechnicalUser(user?: { email?: string | null; nome?: string | null } | null): boolean {
  if (!user) return false;
  const email = (user.email || '').toLowerCase().trim();
  const nome = (user.nome || '').toLowerCase().trim();
  return email.includes('synergieflow') || email.includes('synergiesflow') || nome.includes('synergie flow') || nome.includes('synergies flow') || nome.includes('synergieflow') || nome.includes('synergiesflow');
}

export interface Commessa {
  id: string;
  nome: string;
  colore: string;
  dataInizio?: string;
  dataFine?: string;
  responsabile?: string;
  pm?: string | string[];
  codiceCommessa?: string;
  anno?: string;
  tipologia?: string;
  cliente?: string;
  stato?: string;
  giornateSeniorProject?: number;
  giornateProject?: number;
  giornateJuniorProject?: number;
  apertaDa?: string;
  progetti?: any[];
}

export interface Coordinatore {
  id: string;
  email: string;
  area: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isHR: boolean;
  hrEmails: string[];
  isDev: boolean;
  // isSenior mantenuto nell'interfaccia per retrocompatibilità (Navbar badge), ma sempre false
  isSenior: boolean;
  myAssociatedName: string | null;
  dipendenti: Dipendente[];
  commesse: Commessa[];
  coordinatori: Coordinatore[];
  clienti: { id: string; codice: string; nome: string }[];
  assegnazioni: Record<string, any[]>;
  chiusureAziendali: any[];
  approvedLeaves: any[];
  richiesteDisegnatori: any[];
  pmsEmails: string[];
  // seniorsEmails deprecato: la collezione Firestore 'seniors' è stata rimossa
  commercialiEmails: string[];
  isCommerciale: boolean;
  gestoriCommesseEmails: string[];
  isGestoreCommesse: boolean;
  prioritaCommesse: Record<string, 'Alta' | 'Standard' | 'Bassa'>;
  refreshData: () => Promise<void>;
  refreshDataIfStale: () => Promise<void>;
  loadAllCommesse?: () => Promise<void>;
  loadAssegnazioniForWeeks?: (requestedWeekIds: string[]) => Promise<void>;

  // Impersonificazione
  impersonateUser: (email: string | null) => void;
  isRealDev: boolean;
  impersonatedEmail: string | null;
  userEmail: string;

  // Cessazione Account
  isAccountCessato: boolean;
  cessatoInfo: { isCessato: boolean; dataCessazione: string; nome: string } | null;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [impersonatedEmail, setImpersonatedEmailState] = useState<string | null>(null);
  
  // Dati da Firestore
  const [dynamicAdmins, setDynamicAdmins] = useState<string[]>([]);
  const [dynamicHrs, setDynamicHrs] = useState<string[]>([]);
  const [dynamicDevs, setDynamicDevs] = useState<string[]>([]);
  // dynamicSeniors rimosso: la raccolta 'seniors' su Firestore è deprecata
  // isSenior è sempre false; il badge Navbar è gestito separatamente se necessario

  const [dipendenti, setDipendenti] = useState<Dipendente[]>([]);
  const [commesse, setCommesse] = useState<Commessa[]>([]);
  const [coordinatori, setCoordinatori] = useState<Coordinatore[]>([]);
  const [clienti, setClienti] = useState<{ id: string; codice: string; nome: string }[]>([]);
  const [assegnazioni, setAssegnazioni] = useState<Record<string, any[]>>({});
  const [chiusureAziendali, setChiusureAziendali] = useState<any[]>([]);
  const [approvedLeaves, setApprovedLeaves] = useState<any[]>([]);
  const [richiesteDisegnatori, setRichiesteDisegnatori] = useState<any[]>([]);
  const [pmsEmails, setPmsEmails] = useState<string[]>([]);
  // seniorsEmails: rimosso il fetch Firestore, ora sempre array vuoto per retrocompatibilità
  const [dynamicCommerciali, setDynamicCommerciali] = useState<string[]>([]);
  const [dynamicGestoriCommesse, setDynamicGestoriCommesse] = useState<string[]>([]);
  const [prioritaCommesse, setPrioritaCommesse] = useState<Record<string, 'Alta' | 'Standard' | 'Bassa'>>({});

  const fetchAuthData = async () => {
    try {
      const [
        adminsSnap,
        hrsSnap,
        devsSnap,
        gestoriSnap,
        dipendentiSnap,
        coordinatoriSnap,
        commesseSnap,
        clientiSnap,
        assegnazioniSnap,
        chiusureSnap,
        richiesteDisegnatoriSnap,
        pmsSnap,
        commercialiSnap,
        leavesSnap
      ] = await Promise.all([
        getDocs(collection(db, 'admins')),
        getDocs(collection(db, 'hr')),
        getDocs(collection(db, 'sviluppatori')),
        getDocs(collection(db, 'gestori_commesse')),
        getDocs(collection(db, 'dipendenti')),
        getDocs(collection(db, 'coordinatori')),
        getDocs(collection(db, 'catalogo_commesse')),
        getDocs(collection(db, 'clienti')),
        getDocs(collection(db, 'assegnazioni')),
        getDocs(collection(db, 'chiusure_aziendali')),
        getDocs(query(collection(db, 'richieste_disegnatori'), where('stato', '==', 'in_attesa'))),
        getDocs(collection(db, 'project_managers')),
        getDocs(collection(db, 'commerciali')),
        getDocs(query(collection(db, 'richieste_ferie'), where('stato', '==', 'Approvato')))
      ]);

      // 1. Admins
      const adminsList = adminsSnap.docs.map(doc => doc.data().email?.toLowerCase()).filter(Boolean);
      setDynamicAdmins(adminsList);

      // 2. HR
      const hrsList = hrsSnap.docs.map(doc => doc.data().email?.toLowerCase()).filter(Boolean);
      setDynamicHrs(hrsList);

      // 3. Sviluppatori
      const devsList = devsSnap.docs.map(doc => (doc.data().email || '').toLowerCase().trim()).filter(Boolean);
      if (!devsList.includes('ebartalucci@ingegno06.it')) {
        devsList.push('ebartalucci@ingegno06.it');
      }
      setDynamicDevs(devsList);

      // 4. Gestori commesse
      const gestoriList = gestoriSnap.docs.map(doc => (doc.data().email || '').toLowerCase().trim()).filter(Boolean);
      setDynamicGestoriCommesse(gestoriList);

      // 5. Dipendenti
      const dipList = dipendentiSnap.docs
        .map(doc => ({
          id: doc.id,
          nome: doc.data().nome || '',
          email: doc.data().email || '',
          tipo: doc.data().tipo,
          dailyRate: doc.data().dailyRate,
          inpsRate: doc.data().inpsRate,
          ivaRate: doc.data().ivaRate,
          raRate: doc.data().raRate,
          importoFissoMensile: doc.data().importoFissoMensile,
          oreContratto: doc.data().oreContratto,
          macroArea: doc.data().macroArea,
          dataCessazione: doc.data().dataCessazione || '',
          dataNascita: doc.data().dataNascita || '',
          notificheEmail: doc.data().notificheEmail === true,
        }))
        .filter(d => !isTechnicalUser(d));
      setDipendenti(dipList.sort((a, b) => a.nome.localeCompare(b.nome)));

      // 6. Coordinatori (solo quelli effettivi salvati nel database)
      const coordList = coordinatoriSnap.docs
        .map(doc => ({
          id: doc.id,
          email: (doc.data().email || '').toLowerCase().trim(),
          area: (doc.data().area || '').trim()
        }))
        .filter(c => c.email && c.area);

      // Assicuriamo Corbellini Matteo su Amministrazione se non già presente nel DB
      if (!coordList.some(c => c.email === 'mcorbellini@ingegno06.it' && c.area === 'Amministrazione')) {
        coordList.push({
          id: 'default-coord-admin-mcorbellini',
          email: 'mcorbellini@ingegno06.it',
          area: 'Amministrazione'
        });
      }

      setCoordinatori(coordList);

      // 7. Commesse
      const commesseList = commesseSnap.docs.map(doc => ({
        id: doc.id,
        nome: doc.data().nome || '',
        colore: doc.data().colore || '#3b82f6',
        dataInizio: doc.data().dataInizio || '',
        dataFine: doc.data().dataFine || '',
        responsabile: doc.data().responsabile || '',
        pm: doc.data().pm || '',
        codiceCommessa: doc.data().codiceCommessa || '',
        anno: doc.data().anno || '',
        tipologia: doc.data().tipologia || '',
        cliente: doc.data().cliente || '',
        stato: doc.data().stato || 'Aperta',
        giornateSeniorProject: doc.data().giornateSeniorProject,
        giornateProject: doc.data().giornateProject,
        giornateJuniorProject: doc.data().giornateJuniorProject,
        apertaDa: doc.data().apertaDa || '',
        progetti: doc.data().progetti || []
      }));
      setCommesse(commesseList.sort((a, b) => a.nome.localeCompare(b.nome)));

      // 8. Clienti
      const clientiList = clientiSnap.docs.map(doc => ({
        id: doc.id,
        codice: doc.data().codice || '',
        nome: doc.data().nome || ''
      })).sort((a, b) => Number(a.codice) - Number(b.codice));
      setClienti(clientiList);

      // 9. Assegnazioni
      const ass: Record<string, any[]> = {};
      assegnazioniSnap.forEach(docSnap => {
        ass[docSnap.id] = docSnap.data().lista || [];
      });
      setAssegnazioni(ass);

      // 10. Chiusure aziendali
      const chiusureList = chiusureSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setChiusureAziendali(chiusureList);

      // 11. Richieste disegnatori
      const richiesteDisList = richiesteDisegnatoriSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRichiesteDisegnatori(richiesteDisList);

      // 12. PMs
      setPmsEmails(pmsSnap.docs.map(d => (d.data().email || '').toLowerCase()));

      // 13. Commerciali
      setDynamicCommerciali(commercialiSnap.docs.map(d => (d.data().email || '').toLowerCase()).filter(Boolean));

      // 14. Approved Leaves
      const leavesList: any[] = leavesSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
      setApprovedLeaves(leavesList);

      // 15. Priorita commesse — gestita dal listener real-time (vedi useEffect sotto)
    } catch (err) {
      console.error("Errore nel caricamento dei dati di AuthContext:", err);
    }
  };

  const loadAllCommesse = async () => {
    try {
      const allSnap = await getDocs(collection(db, 'catalogo_commesse'));
      const commesseList = allSnap.docs.map(doc => ({
        id: doc.id,
        nome: doc.data().nome || '',
        colore: doc.data().colore || '#3b82f6',
        dataInizio: doc.data().dataInizio || '',
        dataFine: doc.data().dataFine || '',
        responsabile: doc.data().responsabile || '',
        pm: doc.data().pm || '',
        codiceCommessa: doc.data().codiceCommessa || '',
        anno: doc.data().anno || '',
        tipologia: doc.data().tipologia || '',
        cliente: doc.data().cliente || '',
        stato: doc.data().stato || 'Aperta',
        giornateSeniorProject: doc.data().giornateSeniorProject,
        giornateProject: doc.data().giornateProject,
        giornateJuniorProject: doc.data().giornateJuniorProject,
        apertaDa: doc.data().apertaDa || '',
        progetti: doc.data().progetti || []
      }));
      setCommesse(commesseList.sort((a, b) => a.nome.localeCompare(b.nome)));
    } catch (err) {
      console.error("Errore caricamento catalogo completo commesse:", err);
    }
  };

  // Timestamp dell'ultimo fetch completo (per throttle refreshDataIfStale)
  const lastFetchTimestampRef = useRef<number>(0);

  const refreshData = async () => {
    lastFetchTimestampRef.current = Date.now();
    await fetchAuthData();
  };

  // Versione throttled: non rilancia il fetch se i dati sono stati caricati negli ultimi 2 minuti.
  // Da usare nei mount di pagina (Commesse, PianificazionePersonale) per evitare 14 letture ad ogni navigazione.
  const refreshDataIfStale = async () => {
    const TWO_MINUTES = 2 * 60 * 1000;
    if (Date.now() - lastFetchTimestampRef.current < TWO_MINUTES) return;
    await refreshData();
  };

  // Gestione caricamento iniziale on demand
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setDynamicAdmins([]);
        setDynamicHrs([]);
        setDynamicDevs([]);
        setDipendenti([]);
        setCommesse([]);
        setCoordinatori([]);
        setClienti([]);
        setAssegnazioni({});
        setChiusureAziendali([]);
        setApprovedLeaves([]);
        setRichiesteDisegnatori([]);
        setPmsEmails([]);
        setDynamicCommerciali([]);
        setDynamicGestoriCommesse([]);
        setPrioritaCommesse({});
        setLoading(false);
      } else {
        await fetchAuthData();
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
    };
  }, []);

  // Listener real-time per priorità commesse
  useEffect(() => {
    if (!user) return;
    const unsubPriority = onSnapshot(collection(db, 'priorita_commesse'), (snap) => {
      const prioritaMap: Record<string, 'Alta' | 'Standard' | 'Bassa'> = {};
      snap.forEach(docSnap => {
        const data = docSnap.data();
        if (data.priorita) {
          prioritaMap[docSnap.id] = data.priorita;
        }
      });
      setPrioritaCommesse(prioritaMap);
    }, (err) => console.error("Errore listener priorità commesse:", err));
    return () => unsubPriority();
  }, [user]);

  // Listener real-time per assegnazioni commesse
  useEffect(() => {
    if (!user) return;
    const unsubAssignments = onSnapshot(collection(db, 'assegnazioni'), (snap) => {
      const ass: Record<string, any[]> = {};
      snap.forEach(docSnap => {
        ass[docSnap.id] = docSnap.data().lista || [];
      });
      setAssegnazioni(ass);
    }, (err) => console.error("Errore listener real-time assegnazioni:", err));
    return () => unsubAssignments();
  }, [user]);



  // Calcolo ruoli derivati
  const realEmail = user?.email?.toLowerCase().trim() || '';
  const isDevEmail = (email: string) => {
    if (!email || typeof email !== 'string') return false;
    const clean = email.toLowerCase().trim();
    if (!clean) return false;
    if (clean.includes('ebartalucci') || clean.includes('bartalucci')) return true;
    return dynamicDevs.some(d => d && typeof d === 'string' && d.trim().toLowerCase() === clean);
  };
  const isRealDev = realEmail.includes('ebartalucci@ingegno06.it') || realEmail.includes('synerg') || isDevEmail(realEmail);
  const userEmail = (impersonatedEmail || realEmail).toLowerCase().trim();

  // Quando si impersonifica un utente, isDev valuta SOLO l'email simulata (userEmail),
  // così che la simulazione mostri l'esatta esperienza e permessi dell'utente impersonificato.
  const isDev = isDevEmail(userEmail);
  const isSocio = userEmail.includes('aprofeti') || userEmail.includes('mcorbellini') || userEmail.includes('profeti') || userEmail.includes('corbellini');
  const isAdmin = isDev || isSocio || DEFAULT_ADMINS.some(e => e.toLowerCase().trim() === userEmail) || dynamicAdmins.some(e => e.toLowerCase().trim() === userEmail);
  const isHR = dynamicHrs.some(e => e.toLowerCase().trim() === userEmail);
  // isSenior è deprecato: sempre false. Usare myCoordinatedAreas (dalla collezione coordinatori) per i privilegi di area
  const isSenior = false;
  const isCommerciale = dynamicCommerciali.some(e => e.toLowerCase().trim() === userEmail);
  const isGestoreCommesse = isAdmin || isDev || dynamicGestoriCommesse.some(e => e.toLowerCase().trim() === userEmail);

  useEffect(() => {
    if (isRealDev) {
      const saved = localStorage.getItem('dev_impersonated_email');
      if (saved) {
        setImpersonatedEmailState(saved);
      }
    }
  }, [user, isRealDev]);

  const impersonateUser = (email: string | null) => {
    if (!isRealDev) return;
    if (email) {
      localStorage.setItem('dev_impersonated_email', email.toLowerCase());
      setImpersonatedEmailState(email.toLowerCase());
    } else {
      localStorage.removeItem('dev_impersonated_email');
      setImpersonatedEmailState(null);
    }
  };

  // Tracciamento cessazione utente (reale o simulato)
  const cessatoInfo = (() => {
    if (!userEmail || dipendenti.length === 0) return null;
    const uClean = userEmail.toLowerCase().trim();
    const dipObj = dipendenti.find(d => (d.email || '').toLowerCase().trim() === uClean);
    if (!dipObj || !dipObj.dataCessazione || !dipObj.dataCessazione.trim()) return null;
    const todayISO = new Date().toLocaleDateString('sv-SE');
    if (dipObj.dataCessazione <= todayISO) {
      return {
        isCessato: true,
        dataCessazione: dipObj.dataCessazione,
        nome: dipObj.nome
      };
    }
    return null;
  })();

  const isAccountCessato = Boolean(cessatoInfo?.isCessato);

  const myDip = dipendenti.find(d => {
    if (!userEmail) return false;
    const uClean = userEmail.toLowerCase().trim();
    const dEmail = (d.email || '').toLowerCase().trim();
    if (dEmail && dEmail === uClean) return true;
    const uUser = uClean.split('@')[0];
    const dUser = dEmail.split('@')[0];
    if (uUser && dUser && (uUser.includes(dUser) || dUser.includes(uUser))) return true;
    return false;
  });
  const myAssociatedName = myDip ? myDip.nome : (userEmail ? (
    userEmail.includes('ebartalucci') ? 'Emanuele Bartalucci' :
    userEmail.includes('aprofeti') ? 'Andrea Profeti' :
    userEmail.includes('mcorbellini') ? 'Marco Corbellini' :
    userEmail.includes('taddei') ? 'Taddei Paolo' :
    userEmail.includes('badalassi') ? 'Badalassi Federico' : null
  ) : null);

  const loadAssegnazioniForWeeks = async (requestedWeekIds: string[]) => {
    if (!requestedWeekIds || requestedWeekIds.length === 0) return;
    try {
      const assMap: Record<string, any[]> = {};
      // Firestore 'in' supporta max 30 elementi: batching
      const BATCH_SIZE = 30;
      for (let i = 0; i < requestedWeekIds.length; i += BATCH_SIZE) {
        const batch = requestedWeekIds.slice(i, i + BATCH_SIZE);
        const q = query(collection(db, 'assegnazioni'), where(documentId(), 'in', batch));
        const snap = await getDocs(q);
        snap.forEach((docSnap: any) => {
          assMap[docSnap.id] = docSnap.data().lista || [];
        });
      }
      setAssegnazioni(prev => ({ ...prev, ...assMap }));
    } catch (err) {
      console.error("Errore caricamento assegnazioni per settimane richieste:", err);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      isAdmin,
      isHR,
      hrEmails: dynamicHrs,
      isDev,
      isSenior,
      myAssociatedName,
      dipendenti,
      commesse,
      coordinatori,
      clienti,
      assegnazioni,
      chiusureAziendali,
      approvedLeaves,
      richiesteDisegnatori,
      pmsEmails,
      commercialiEmails: dynamicCommerciali,
      isCommerciale,
      gestoriCommesseEmails: dynamicGestoriCommesse,
      isGestoreCommesse,
      prioritaCommesse,
      refreshData,
      refreshDataIfStale,
      loadAllCommesse,
      loadAssegnazioniForWeeks,
      impersonateUser,
      isRealDev,
      impersonatedEmail,
      userEmail,
      isAccountCessato,
      cessatoInfo
    }}>
      {children}
    </AuthContext.Provider>
  );
};
