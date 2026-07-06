import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { type User, onAuthStateChanged } from 'firebase/auth';
import { collection, doc, addDoc, deleteDoc, getDocs, getDoc } from 'firebase/firestore';
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
  macroArea?: 'Disegnatori' | 'Ingegneria' | 'Cantieri / Ambiente' | 'Amministrazione';
}

export interface Commessa {
  id: string;
  nome: string;
  colore: string;
  dataInizio?: string;
  dataFine?: string;
  responsabile?: string;
  pm?: string;
  codiceCommessa?: string;
  anno?: string;
  tipologia?: string;
  cliente?: string;
  stato?: string;
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
  refreshData: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Dati da Firestore
  const [dynamicAdmins, setDynamicAdmins] = useState<string[]>([]);
  const [dynamicHrs, setDynamicHrs] = useState<string[]>([]);
  const [dynamicSeniors, setDynamicSeniors] = useState<string[]>([]);
  const [dipendenti, setDipendenti] = useState<Dipendente[]>([]);
  const [commesse, setCommesse] = useState<Commessa[]>([]);
  const [coordinatori, setCoordinatori] = useState<Coordinatore[]>([]);

  // Funzione per caricare/aggiornare i dati on-demand
  const refreshData = async (currentUser?: User | null) => {
    const activeUser = currentUser !== undefined ? currentUser : user;
    if (!activeUser) {
      setDynamicAdmins([]);
      setDynamicHrs([]);
      setDynamicSeniors([]);
      setDipendenti([]);
      setCommesse([]);
      setCoordinatori([]);
      return;
    }

    try {
      const [adminsSnap, seniorsSnap, hrSnap, dipendentiSnap, commesseSnap, legacyHrSnap, coordinatoriSnap] = await Promise.all([
        getDocs(collection(db, 'admins')),
        getDocs(collection(db, 'seniors')),
        getDocs(collection(db, 'hr')),
        getDocs(collection(db, 'dipendenti')),
        getDocs(collection(db, 'catalogo_commesse')),
        getDoc(doc(db, 'configurazione_sistema', 'hr')),
        getDocs(collection(db, 'coordinatori'))
      ]);

      setDynamicAdmins(adminsSnap.docs.map(doc => doc.data().email?.toLowerCase()));
      setDynamicSeniors(seniorsSnap.docs.map(doc => doc.data().email?.toLowerCase()));
      setDynamicHrs(hrSnap.docs.map(doc => doc.data().email?.toLowerCase()).filter(Boolean));

      // Automatic migration from legacy hr document to new 'hr' collection
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

      const deps = dipendentiSnap.docs.map(doc => ({
        id: doc.id,
        nome: doc.data().nome,
        email: doc.data().email || "",
        tipo: doc.data().tipo,
        dailyRate: doc.data().dailyRate,
        inpsRate: doc.data().inpsRate,
        ivaRate: doc.data().ivaRate,
        raRate: doc.data().raRate,
        oreContratto: doc.data().oreContratto,
        macroArea: doc.data().macroArea,
      }));
      setDipendenti(deps.sort((a, b) => a.nome.localeCompare(b.nome)));

      const coords = coordinatoriSnap.docs.map(doc => ({
        id: doc.id,
        email: doc.data().email || '',
        area: doc.data().area || ''
      }));
      setCoordinatori(coords);

      const comms = commesseSnap.docs.map(doc => ({
        id: doc.id,
        nome: doc.data().nome,
        colore: doc.data().colore || '#3b82f6',
        dataInizio: doc.data().dataInizio || '',
        dataFine: doc.data().dataFine || '',
        responsabile: doc.data().responsabile || '',
        pm: doc.data().pm || '',
        codiceCommessa: doc.data().codiceCommessa || '',
        anno: doc.data().anno || '',
        tipologia: doc.data().tipologia || '',
        cliente: doc.data().cliente || '',
        stato: doc.data().stato || 'Aperta'
      }));
      setCommesse(comms.sort((a, b) => a.nome.localeCompare(b.nome)));

    } catch (error) {
      console.error("Error refreshing auth context data:", error);
    }
  };

  // Ascolto stato utente Firebase e caricamento dati iniziali
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setDynamicAdmins([]);
        setDynamicHrs([]);
        setDynamicSeniors([]);
        setDipendenti([]);
        setCommesse([]);
        setCoordinatori([]);
        setLoading(false);
      } else {
        try {
          await refreshData(currentUser);
        } catch (error) {
          console.error("Error loading initial data:", error);
        } finally {
          setLoading(false);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Calcolo ruoli derivati
  const userEmail = user?.email?.toLowerCase() || '';
  const isAdmin = DEFAULT_ADMINS.includes(userEmail) || dynamicAdmins.includes(userEmail);
  const isHR = dynamicHrs.includes(userEmail);
  const isSenior = dynamicSeniors.includes(userEmail);
  
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
      refreshData
    }}>
      {children}
    </AuthContext.Provider>
  );
};
