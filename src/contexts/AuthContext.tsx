import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { type User, onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../services/firebase';

const DEFAULT_ADMINS = ['aprofeti@ingegno06.it', 'mcorbellini@ingegno06.it'];

export interface Dipendente {
  id: string;
  nome: string;
  email: string;
  tipo?: 'dipendente' | 'collaboratore';
}

export interface Commessa {
  id: string;
  nome: string;
  colore: string;
  dataInizio?: string;
  dataFine?: string;
  responsabile?: string;
  pm?: string;
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
  const [hrEmail, setHrEmail] = useState<string | null>(null);
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

    const unsubHr = onSnapshot(doc(db, 'configurazione_sistema', 'hr'), (docSnap) => {
      setHrEmail(docSnap.exists() ? docSnap.data().email?.toLowerCase() : null);
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
        pm: doc.data().pm || ''
      }));
      setCommesse(comms.sort((a, b) => a.nome.localeCompare(b.nome)));
    });

    return () => {
      unsubAdmins();
      unsubSeniors();
      unsubHr();
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
  const isHR = hrEmail === userEmail;
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
