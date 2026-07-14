import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { type User, onAuthStateChanged } from 'firebase/auth';
import { collection, doc, addDoc, deleteDoc, getDoc, onSnapshot } from 'firebase/firestore';
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
  macroArea?: 'Disegnatori' | 'Ingegneria' | 'Sicurezza Cantieri' | 'Consulenza Sicurezza' | 'Amministrazione';
  dataCessazione?: string;
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
  seniorsEmails: string[];
  commercialiEmails: string[];
  isCommerciale: boolean;
  refreshData: () => Promise<void>;

  // Impersonificazione
  impersonateUser: (email: string | null) => void;
  isRealDev: boolean;
  impersonatedEmail: string | null;
  userEmail: string;
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
  const [dynamicSeniors, setDynamicSeniors] = useState<string[]>([]);
  
  const [dipendenti, setDipendenti] = useState<Dipendente[]>([]);
  const [commesse, setCommesse] = useState<Commessa[]>([]);
  const [coordinatori, setCoordinatori] = useState<Coordinatore[]>([]);
  const [clienti, setClienti] = useState<{ id: string; codice: string; nome: string }[]>([]);
  const [assegnazioni, setAssegnazioni] = useState<Record<string, any[]>>({});
  const [chiusureAziendali, setChiusureAziendali] = useState<any[]>([]);
  const [approvedLeaves, setApprovedLeaves] = useState<any[]>([]);
  const [richiesteDisegnatori, setRichiesteDisegnatori] = useState<any[]>([]);
  const [pmsEmails, setPmsEmails] = useState<string[]>([]);
  const [seniorsEmails, setSeniorsEmails] = useState<string[]>([]);
  const [dynamicCommerciali, setDynamicCommerciali] = useState<string[]>([]);


  // Funzione mock retrocompatibile
  const refreshData = async () => {
    return Promise.resolve();
  };

  // Gestione ascoltatori real-time persistenti
  useEffect(() => {
    let unsubs: (() => void)[] = [];

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      // Pulisci ascoltatori precedenti
      unsubs.forEach(unsub => unsub());
      unsubs = [];

      if (!currentUser) {
        setDynamicAdmins([]);
        setDynamicHrs([]);
        setDynamicSeniors([]);
        setDipendenti([]);
        setCommesse([]);
        setCoordinatori([]);
        setClienti([]);
        setAssegnazioni({});
        setChiusureAziendali([]);
        setApprovedLeaves([]);
        setRichiesteDisegnatori([]);
        setPmsEmails([]);
        setSeniorsEmails([]);
        setDynamicCommerciali([]);
        setLoading(false);
      } else {
        try {
          // 1. Admins
          unsubs.push(onSnapshot(collection(db, 'admins'), (snap) => {
            const list = snap.docs.map(doc => doc.data().email?.toLowerCase()).filter(Boolean);
            setDynamicAdmins(list);
          }));

          // 2. Seniors
          unsubs.push(onSnapshot(collection(db, 'seniors'), (snap) => {
            const list = snap.docs.map(doc => doc.data().email?.toLowerCase()).filter(Boolean);
            setDynamicSeniors(list);
            setSeniorsEmails(list);
          }));

          // 3. HR
          unsubs.push(onSnapshot(collection(db, 'hr'), (snap) => {
            const list = snap.docs.map(doc => doc.data().email?.toLowerCase()).filter(Boolean);
            setDynamicHrs(list);
          }));

          // 4. Dipendenti
          unsubs.push(onSnapshot(collection(db, 'dipendenti'), (snap) => {
            const list = snap.docs.map(doc => ({
              id: doc.id,
              nome: doc.data().nome || '',
              email: doc.data().email || '',
              tipo: doc.data().tipo,
              dailyRate: doc.data().dailyRate,
              inpsRate: doc.data().inpsRate,
              ivaRate: doc.data().ivaRate,
              raRate: doc.data().raRate,
              oreContratto: doc.data().oreContratto,
              macroArea: doc.data().macroArea,
              dataCessazione: doc.data().dataCessazione || '',
            }));
            setDipendenti(list.sort((a, b) => a.nome.localeCompare(b.nome)));
          }));

          // 5. Coordinatori
          unsubs.push(onSnapshot(collection(db, 'coordinatori'), (snap) => {
            const list = snap.docs.map(doc => ({
              id: doc.id,
              email: doc.data().email || '',
              area: doc.data().area || ''
            }));
            setCoordinatori(list);
          }));

          // 6. Commesse
          unsubs.push(onSnapshot(collection(db, 'catalogo_commesse'), (snap) => {
            const list = snap.docs.map(doc => ({
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
            }));
            setCommesse(list.sort((a, b) => a.nome.localeCompare(b.nome)));
          }));

          // 7. Clienti
          unsubs.push(onSnapshot(collection(db, 'clienti'), (snap) => {
            const list = snap.docs.map(doc => ({
              id: doc.id,
              codice: doc.data().codice || '',
              nome: doc.data().nome || ''
            })).sort((a, b) => Number(a.codice) - Number(b.codice));
            setClienti(list);
          }));

          // 8. Assegnazioni
          unsubs.push(onSnapshot(collection(db, 'assegnazioni'), (snap) => {
            const ass: Record<string, any[]> = {};
            snap.forEach(docSnap => {
              ass[docSnap.id] = docSnap.data().lista || [];
            });
            setAssegnazioni(ass);
          }));

          // 9. Chiusure aziendali
          unsubs.push(onSnapshot(collection(db, 'chiusure_aziendali'), (snap) => {
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setChiusureAziendali(list);
          }));

          // 10. Richieste disegnatori
          unsubs.push(onSnapshot(collection(db, 'richieste_disegnatori'), (snap) => {
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setRichiesteDisegnatori(list);
          }));

          // 11. Project Managers
          unsubs.push(onSnapshot(collection(db, 'project_managers'), (snap) => {
            setPmsEmails(snap.docs.map(d => (d.data().email || '').toLowerCase()));
          }));

          // 13. Commerciali
          unsubs.push(onSnapshot(collection(db, 'commerciali'), (snap) => {
            setDynamicCommerciali(snap.docs.map(d => (d.data().email || '').toLowerCase()).filter(Boolean));
          }));

          // 12. Richieste ferie (approved leaves)
          unsubs.push(onSnapshot(collection(db, 'richieste_ferie'), (snap) => {
            const list: any[] = [];
            snap.forEach(docSnap => {
              const data = docSnap.data();
              if (data.stato === 'Approvato') {
                list.push({ id: docSnap.id, ...data });
              }
            });
            setApprovedLeaves(list);
          }));

          // Migrazione automatica HR
          const legacyHrSnap = await getDoc(doc(db, 'configurazione_sistema', 'hr'));
          if (legacyHrSnap.exists()) {
            const legacyEmail = legacyHrSnap.data().email?.toLowerCase();
            if (legacyEmail) {
              try {
                await addDoc(collection(db, 'hr'), { email: legacyEmail });
                await deleteDoc(doc(db, 'configurazione_sistema', 'hr'));
              } catch (err) {
                console.error("Migration error:", err);
              }
            }
          }

        } catch (err) {
          console.error("Error setting up real-time onSnapshot listeners:", err);
        } finally {
          setLoading(false);
        }
      }
    });

    return () => {
      unsubscribeAuth();
      unsubs.forEach(unsub => unsub());
    };
  }, []);

  // Calcolo ruoli derivati
  const realEmail = user?.email?.toLowerCase() || '';
  const isRealDev = realEmail === 'ebartalucci@ingegno06.it';

  useEffect(() => {
    if (isRealDev) {
      setImpersonatedEmailState(localStorage.getItem('dev_impersonated_email'));
    } else {
      setImpersonatedEmailState(null);
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

  const userEmail = impersonatedEmail || realEmail;
  const isAdmin = DEFAULT_ADMINS.includes(userEmail) || dynamicAdmins.includes(userEmail);
  const isHR = dynamicHrs.includes(userEmail);
  const isSenior = dynamicSeniors.includes(userEmail);
  const isCommerciale = dynamicCommerciali.includes(userEmail);
  
  const myDip = dipendenti.find(d => d.email?.toLowerCase() === userEmail);
  const myAssociatedName = myDip ? myDip.nome : null;

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      isAdmin,
      isHR,
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
      seniorsEmails,
      commercialiEmails: dynamicCommerciali,
      isCommerciale,
      refreshData,
      impersonateUser,
      isRealDev,
      impersonatedEmail,
      userEmail
    }}>
      {children}
    </AuthContext.Provider>
  );
};
