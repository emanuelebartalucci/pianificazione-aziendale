import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { type User, onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot, addDoc, deleteDoc } from 'firebase/firestore';
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

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isHR: boolean;
  isSenior: boolean;
  myAssociatedName: string | null;
  dipendenti: Dipendente[];
  commesse: Commessa[];
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

  // Listeners Firestore base
  useEffect(() => {
    const unsubAdmins = onSnapshot(collection(db, 'admins'), (snapshot) => {
      setDynamicAdmins(snapshot.docs.map(doc => doc.data().email?.toLowerCase()));
    });

    const unsubSeniors = onSnapshot(collection(db, 'seniors'), (snapshot) => {
      setDynamicSeniors(snapshot.docs.map(doc => doc.data().email?.toLowerCase()));
    });

    const unsubHr = onSnapshot(collection(db, 'hr'), (snapshot) => {
      setDynamicHrs(snapshot.docs.map(doc => doc.data().email?.toLowerCase()).filter(Boolean));
    });

    // Automatic migration from legacy hr document to new 'hr' collection
    const unsubLegacyHr = onSnapshot(doc(db, 'configurazione_sistema', 'hr'), async (docSnap) => {
      if (docSnap.exists()) {
        const legacyEmail = docSnap.data().email?.toLowerCase();
        if (legacyEmail) {
          try {
            await addDoc(collection(db, 'hr'), { email: legacyEmail });
            await deleteDoc(doc(db, 'configurazione_sistema', 'hr'));
          } catch (err) {
            console.error("Migration error:", err);
          }
        }
      }
    });

    const unsubDipendenti = onSnapshot(collection(db, 'dipendenti'), (snapshot) => {
      const deps = snapshot.docs.map(doc => ({
        id: doc.id,
        nome: doc.data().nome,
        email: doc.data().email || "",
        tipo: doc.data().tipo
      }));
      setDipendenti(deps.sort((a, b) => a.nome.localeCompare(b.nome)));
    });

    const unsubCommesse = onSnapshot(collection(db, 'catalogo_commesse'), (snapshot) => {
      const comms = snapshot.docs.map(doc => ({
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
    });

    return () => {
      unsubAdmins();
      unsubSeniors();
      unsubHr();
      unsubLegacyHr();
      unsubDipendenti();
      unsubCommesse();
    };
  }, []);

  // Ascolto stato utente Firebase
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
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
      commesse
    }}>
      {children}
    </AuthContext.Provider>
  );
};
