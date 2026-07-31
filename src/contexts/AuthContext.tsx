import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { type User, onAuthStateChanged } from 'firebase/auth';
import { collection, doc, addDoc, deleteDoc, getDoc, onSnapshot, query, where, type QuerySnapshot } from 'firebase/firestore';
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
        try {
          // 1. Admins
          unsubs.push(onSnapshot(collection(db, 'admins'), (snap) => {
            const list = snap.docs.map(doc => doc.data().email?.toLowerCase()).filter(Boolean);
            setDynamicAdmins(list);
          }));

          // 2. Seniors — RIMOSSO: la raccolta Firestore 'seniors' è deprecata
          // isSenior è sempre false; usare la collezione 'coordinatori' per i privilegi di area

          // 3. HR
          unsubs.push(onSnapshot(collection(db, 'hr'), (snap) => {
            const list = snap.docs.map(doc => doc.data().email?.toLowerCase()).filter(Boolean);
            setDynamicHrs(list);
          }));

          // 3.b Sviluppatori (Dev)
          unsubs.push(onSnapshot(collection(db, 'sviluppatori'), (snap) => {
            const list = snap.docs.map(doc => (doc.data().email || '').toLowerCase().trim()).filter(Boolean);
            if (!list.includes('ebartalucci@ingegno06.it')) {
              list.push('ebartalucci@ingegno06.it');
            }
            setDynamicDevs(list);
          }));

          // 3.c Gestori Commesse
          unsubs.push(onSnapshot(collection(db, 'gestori_commesse'), (snap) => {
            const list = snap.docs.map(doc => (doc.data().email || '').toLowerCase().trim()).filter(Boolean);
            setDynamicGestoriCommesse(list);
          }));

          // 4. Dipendenti
          unsubs.push(onSnapshot(collection(db, 'dipendenti'), (snap) => {
            const list = snap.docs
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
                notificheEmail: doc.data().notificheEmail === true,
              }))
              .filter(d => !isTechnicalUser(d));
            setDipendenti(list.sort((a, b) => a.nome.localeCompare(b.nome)));
          }));

          // 5. Coordinatori
          unsubs.push(onSnapshot(collection(db, 'coordinatori'), (snap) => {
            const list = snap.docs.map(doc => ({
              id: doc.id,
              email: doc.data().email || '',
              area: doc.data().area || ''
            }));
            
            // Eccezione esplicita per Corbellini Matteo (mcorbellini@ingegno06.it) per l'area Amministrazione
            if (!list.some(c => c.email?.toLowerCase().trim() === 'mcorbellini@ingegno06.it' && c.area === 'Amministrazione')) {
              list.push({
                id: 'default-mcorbellini-amministrazione',
                email: 'mcorbellini@ingegno06.it',
                area: 'Amministrazione'
              });
            }

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
              apertaDa: doc.data().apertaDa || '',
              progetti: doc.data().progetti || []
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

          // 12. Richieste ferie (approved leaves) - query filtrata alla fonte
          unsubs.push(onSnapshot(query(collection(db, 'richieste_ferie'), where('stato', '==', 'Approvato')), (snap: QuerySnapshot) => {
            const list: any[] = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            setApprovedLeaves(list);
          }));

          // 14. Priorità commesse settimanali
          unsubs.push(onSnapshot(collection(db, 'priorita_commesse'), (snap) => {
            const map: Record<string, 'Alta' | 'Standard' | 'Bassa'> = {};
            snap.forEach(docSnap => {
              const data = docSnap.data();
              if (data.priorita) {
                map[docSnap.id] = data.priorita;
              }
            });
            setPrioritaCommesse(map);
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
  const realEmail = user?.email?.toLowerCase().trim() || '';
  const isDevEmail = (email: string) => {
    if (!email || typeof email !== 'string') return false;
    const clean = email.toLowerCase().trim();
    if (!clean) return false;
    if (clean.includes('ebartalucci') || clean.includes('bartalucci')) return true;
    return dynamicDevs.some(d => d && typeof d === 'string' && d.trim().toLowerCase() === clean);
  };
  const isRealDev = isDevEmail(realEmail);
  const userEmail = impersonatedEmail || realEmail;
  const isDev = isDevEmail(userEmail);
  const isAdmin = isDev || DEFAULT_ADMINS.includes(userEmail) || dynamicAdmins.includes(userEmail);
  const isHR = dynamicHrs.includes(userEmail);
  // isSenior è deprecato: sempre false. Usare myCoordinatedAreas (dalla collezione coordinatori) per i privilegi di area
  const isSenior = false;
  const isCommerciale = dynamicCommerciali.includes(userEmail);
  const isGestoreCommesse = isAdmin || isDev || dynamicGestoriCommesse.includes(userEmail);

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
  const myAssociatedName = myDip ? myDip.nome : null;

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      isAdmin,
      isHR,
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
      impersonateUser,
      isRealDev,
      impersonatedEmail,
      userEmail
    }}>
      {children}
    </AuthContext.Provider>
  );
};
