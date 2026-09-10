import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
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
  dataAssunzione?: string;
  dataNascita?: string;
  orarioSettimanale?: { lun: number; mar: number; mer: number; gio: number; ven: number };
  decorrenzaOrario?: {
    giorno: number;
    mese: number;
    anno: number;
    vecchioOrarioSettimanale?: { lun: number; mar: number; mer: number; gio: number; ven: number };
    vecchioOreContratto?: number;
  };
  notificheEmail?: boolean;
}

export function isTechnicalUser(user?: { email?: string | null; nome?: string | null } | null): boolean {
  if (!user) return false;
  const email = (user.email || '').toLowerCase().trim();
  const nome = (user.nome || '').toLowerCase().trim();
  return email.includes('synergieflow') || email.includes('synergiesflow') || nome.includes('synergie flow') || nome.includes('synergies flow') || nome.includes('synergieflow') || nome.includes('synergiesflow');
}

export const isSoci = (nomeOrEmail?: string | null): boolean => {
  if (!nomeOrEmail) return false;
  const clean = nomeOrEmail.trim().toLowerCase();
  return clean.includes('corbellini') || clean.includes('profeti') || clean.includes('aprofeti') || clean.includes('mcorbellini');
};

export const areNamesEqual = (n1?: string | null, n2?: string | null): boolean => {
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;
  const clean1 = n1.toLowerCase().trim().replace(/\s+/g, ' ');
  const clean2 = n2.toLowerCase().trim().replace(/\s+/g, ' ');
  if (clean1 === clean2) return true;
  if (clean1.length !== clean2.length) return false;
  const parts1 = clean1.split(' ');
  const parts2 = clean2.split(' ');
  if (parts1.length !== parts2.length || parts1.length <= 1) return false;
  return parts1.sort().join(' ') === parts2.sort().join(' ');
};

export const isDevEmail = (email?: string | null, devsList: string[] = []): boolean => {
  if (!email || typeof email !== 'string') return false;
  const clean = email.toLowerCase().trim();
  if (!clean) return false;
  if (clean.includes('ebartalucci') || clean.includes('bartalucci')) return true;
  return devsList.some(d => d && typeof d === 'string' && d.trim().toLowerCase() === clean);
};

export const getAssociatedNameFromEmail = (email?: string | null, dipendentiList: Dipendente[] = []): string | null => {
  if (!email) return null;
  const uClean = email.toLowerCase().trim();
  const myDip = dipendentiList.find(d => {
    const dEmail = (d.email || '').toLowerCase().trim();
    if (dEmail && dEmail === uClean) return true;
    const uUser = uClean.split('@')[0];
    const dUser = dEmail.split('@')[0];
    if (uUser && dUser && (uUser.includes(dUser) || dUser.includes(uUser))) return true;
    return false;
  });
  if (myDip) return myDip.nome;
  if (uClean.includes('ebartalucci')) return 'Emanuele Bartalucci';
  if (uClean.includes('aprofeti')) return 'Andrea Profeti';
  if (uClean.includes('mcorbellini')) return 'Marco Corbellini';
  if (uClean.includes('taddei')) return 'Taddei Paolo';
  if (uClean.includes('badalassi')) return 'Badalassi Federico';
  return null;
};

export const TODO_CATEGORIE = [
  'aggiornare',
  'archiviare',
  'attesa feedback',
  'bim/cad',
  'chiamare',
  'consegnare',
  'da fare',
  'effettuare revisione',
  'fatturare',
  'firmare',
  'fissare appuntamento',
  'intervento it',
  'inviare mail',
  'ordinare',
  'pagare',
  'prenotare',
  'registrare',
  'rispondere',
  'scansionare',
  'stampare'
] as const;


export type ToDoCategoria = typeof TODO_CATEGORIE[number];

export interface TodoAttachment {
  id: string;
  percorso: string;
  nome: string;
  tipo: 'file' | 'cartella';
  estensione?: string;
}

export interface PunchListItem {
  id: string;
  categoria?: string; // una delle 18 categorie TODO_CATEGORIE
  priorita?: 'Alta' | 'Standard' | 'Bassa'; // Priorità operativa (default: Standard)
  titolo: string;
  descrizione?: string;
  scadenza?: string; // YYYY-MM-DD
  assegnatiA?: string[]; // Nomi dipendenti assegnatari multipli
  assegnatoA: string; // Nome dipendente incaricato (retrocompatibile)
  stato: 'da_fare' | 'completato' | 'eseguito' | 'da_rivedere';
  creatoDa: string;
  creatoDaEmail?: string;
  creatoIl: string; // ISO date
  completatoDa?: string;
  completatoIl?: string;
  approvatoDa?: string;
  approvatoIl?: string;
  noteRevisione?: string;
  // Collegamento a file o cartella su server (retrocompatibile)
  allegatoPercorso?: string;
  allegatoNome?: string;
  allegatoTipo?: 'file' | 'cartella';
  allegatoEstensione?: string;
  // Nuovo supporto allegati multipli
  allegati?: TodoAttachment[];
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
  percorsoRete?: string;
  punchList?: PunchListItem[];
  giornateSeniorProject?: number;
  giornateProject?: number;
  giornateJuniorProject?: number;
  apertaDa?: string;
  progetti?: any[];
  abilitatiExtra?: string[];
}

export const mapDocToCommessa = (docSnap: any): Commessa => {
  const data = typeof docSnap.data === 'function' ? docSnap.data() : docSnap;
  return {
    id: docSnap.id,
    nome: data.nome || '',
    colore: data.colore || '#3b82f6',
    dataInizio: data.dataInizio || '',
    dataFine: data.dataFine || '',
    responsabile: data.responsabile || '',
    pm: data.pm || '',
    codiceCommessa: data.codiceCommessa || '',
    anno: data.anno || '',
    tipologia: data.tipologia || '',
    cliente: data.cliente || '',
    stato: data.stato || 'Aperta',
    percorsoRete: data.percorsoRete || '',
    punchList: data.punchList || [],
    abilitatiExtra: Array.isArray(data.abilitatiExtra) ? data.abilitatiExtra : (data.abilitatiExtra ? [data.abilitatiExtra] : []),
    giornateSeniorProject: data.giornateSeniorProject,
    giornateProject: data.giornateProject,
    giornateJuniorProject: data.giornateJuniorProject,
    apertaDa: data.apertaDa || '',
    progetti: data.progetti || []
  };
};

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
  responsabiliCommesseEmails: string[];
  gestoriFornitureEmails: string[];
  isGestoreForniture: boolean;
  prioritaCommesse: Record<string, 'Alta' | 'Standard' | 'Bassa'>;
  isPlanningLoaded: boolean;
  loadPlanningData: () => Promise<void>;
  updateCommessaPunchList: (commessaId: string, punchList: PunchListItem[]) => void;
  refreshCommesse: () => Promise<void>;
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
  const [dynamicResponsabiliCommesse, setDynamicResponsabiliCommesse] = useState<string[]>([]);
  const [dynamicGestoriForniture, setDynamicGestoriForniture] = useState<string[]>([]);
  const [prioritaCommesse, setPrioritaCommesse] = useState<Record<string, 'Alta' | 'Standard' | 'Bassa'>>({});
  const [isPlanningLoaded, setIsPlanningLoaded] = useState(false);
  const isPlanningLoadingRef = useRef(false);
  const isPlanningLoadedRef = useRef(false);

  const fetchAuthData = async () => {
    try {
      const [
        adminsSnap,
        hrsSnap,
        devsSnap,
        gestoriSnap,
        responsabiliCommesseSnap,
        gestoriFornitureSnap,
        dipendentiSnap,
        coordinatoriSnap,
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
        getDocs(collection(db, 'responsabili_commesse')),
        getDocs(collection(db, 'gestori_forniture')),
        getDocs(collection(db, 'dipendenti')),
        getDocs(collection(db, 'coordinatori')),
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

      // 4b. Responsabili commesse
      const respCommesseList = responsabiliCommesseSnap.docs.map(doc => (doc.data().email || '').toLowerCase().trim()).filter(Boolean);
      setDynamicResponsabiliCommesse(respCommesseList);

      // 4c. Gestori forniture & materiali
      const fornitureList = gestoriFornitureSnap.docs.map(doc => (doc.data().email || '').toLowerCase().trim()).filter(Boolean);
      setDynamicGestoriForniture(fornitureList);

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
          dataAssunzione: doc.data().dataAssunzione || '',
          dataNascita: doc.data().dataNascita || '',
          orarioSettimanale: doc.data().orarioSettimanale || undefined,
          decorrenzaOrario: doc.data().decorrenzaOrario || undefined,
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

      // 7. Chiusure aziendali
      const chiusureList = chiusureSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setChiusureAziendali(chiusureList);

      // 8. Richieste disegnatori
      const richiesteDisList = richiesteDisegnatoriSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRichiesteDisegnatori(richiesteDisList);

      // 9. PMs
      setPmsEmails(pmsSnap.docs.map(d => (d.data().email || '').toLowerCase()));

      // 10. Commerciali
      setDynamicCommerciali(commercialiSnap.docs.map(d => (d.data().email || '').toLowerCase()).filter(Boolean));

      // 11. Approved Leaves
      const leavesList: any[] = leavesSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
      setApprovedLeaves(leavesList);

    } catch (err) {
      console.error("Errore nel caricamento dei dati di AuthContext:", err);
    }
  };

  // Caricamento On-Demand (Lazy Loading) e Centralizzato per la Pianificazione
  const loadPlanningData = useCallback(async () => {
    if (isPlanningLoadingRef.current || isPlanningLoadedRef.current) return;
    isPlanningLoadingRef.current = true;
    try {
      // 1. Scarica clienti, priorità e tutte le assegnazioni del team
      const [clientiSnap, prioritySnap, assSnap] = await Promise.all([
        getDocs(collection(db, 'clienti')),
        getDocs(collection(db, 'priorita_commesse')),
        getDocs(collection(db, 'assegnazioni'))
      ]);

      const clientiList = clientiSnap.docs.map(doc => ({
        id: doc.id,
        codice: doc.data().codice || '',
        nome: doc.data().nome || ''
      })).sort((a, b) => Number(a.codice) - Number(b.codice));
      setClienti(clientiList);

      const prioritaMap: Record<string, 'Alta' | 'Standard' | 'Bassa'> = {};
      prioritySnap.forEach(docSnap => {
        const data = docSnap.data();
        if (data.priorita) prioritaMap[docSnap.id] = data.priorita;
      });
      setPrioritaCommesse(prioritaMap);

      const ass: Record<string, any[]> = {};
      assSnap.forEach(docSnap => {
        ass[docSnap.id] = docSnap.data().lista || [];
      });
      setAssegnazioni(ass);

      // 2. Carica tutte le commesse APERTE del catalogo attivo (escludendo l'archivio storico delle chiuse)
      // Garantisce che tutti i collaboratori e dipendenti abbiano a disposizione i task delle loro commesse aperte
      let commesseDocs: any[] = [];
      try {
        const qOpen = query(collection(db, 'catalogo_commesse'), where('stato', '!=', 'Chiusa'));
        const snapOpen = await getDocs(qOpen);
        if (!snapOpen.empty) {
          commesseDocs = snapOpen.docs;
        } else {
          const snapAll = await getDocs(collection(db, 'catalogo_commesse'));
          commesseDocs = snapAll.docs.filter(d => (d.data().stato || 'Aperta') !== 'Chiusa');
        }
      } catch {
        const snapAll = await getDocs(collection(db, 'catalogo_commesse'));
        commesseDocs = snapAll.docs.filter(d => (d.data().stato || 'Aperta') !== 'Chiusa');
      }

      const commesseList = commesseDocs.map(mapDocToCommessa);
      setCommesse(commesseList.sort((a, b) => a.nome.localeCompare(b.nome)));

      isPlanningLoadedRef.current = true;
      setIsPlanningLoaded(true);
    } catch (err) {
      console.error("Errore caricamento dati pianificazione on-demand:", err);
    } finally {
      isPlanningLoadingRef.current = false;
    }
  }, [user, impersonatedEmail, dipendenti, coordinatori, dynamicAdmins, dynamicHrs, dynamicDevs]);

  const loadAllCommesse = async () => {
    try {
      const [allSnap, clientiSnap] = await Promise.all([
        getDocs(collection(db, 'catalogo_commesse')),
        getDocs(collection(db, 'clienti'))
      ]);
      const commesseList = allSnap.docs.map(mapDocToCommessa);
      setCommesse(commesseList.sort((a, b) => a.nome.localeCompare(b.nome)));

      const clientiList = clientiSnap.docs.map(doc => ({
        id: doc.id,
        codice: doc.data().codice || '',
        nome: doc.data().nome || ''
      })).sort((a, b) => Number(a.codice) - Number(b.codice));
      setClienti(clientiList);
    } catch (err) {
      console.error("Errore caricamento catalogo completo commesse:", err);
    }
  };

  // Aggiornamento reattivo immediato della punchList di una commessa nello stato in-memory
  const updateCommessaPunchList = useCallback((commessaId: string, updatedPunchList: PunchListItem[]) => {
    setCommesse(prev => prev.map(c => c.id === commessaId ? { ...c, punchList: updatedPunchList } : c));
  }, []);

  // Refresh rapido mirato delle commesse aperte da Firestore (per sincronizzare i ToDo di commessa senza ricaricare tutta l'app)
  const refreshCommesse = useCallback(async () => {
    try {
      const qOpen = query(collection(db, 'catalogo_commesse'), where('stato', '!=', 'Chiusa'));
      let snapOpen = await getDocs(qOpen);
      let docs = snapOpen.docs;
      if (docs.length === 0) {
        const snapAll = await getDocs(collection(db, 'catalogo_commesse'));
        docs = snapAll.docs.filter(d => (d.data().stato || 'Aperta') !== 'Chiusa');
      }
      const list = docs.map(mapDocToCommessa);
      setCommesse(list.sort((a, b) => a.nome.localeCompare(b.nome)));
    } catch (err) {
      console.error("Errore refresh rapido commesse:", err);
    }
  }, []);

  // Timestamp dell'ultimo fetch completo (per throttle refreshDataIfStale)
  const lastFetchTimestampRef = useRef<number>(0);

  const refreshData = async () => {
    lastFetchTimestampRef.current = Date.now();
    await fetchAuthData();
    isPlanningLoadingRef.current = false;
    isPlanningLoadedRef.current = false;
    await loadPlanningData();
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
        setDynamicResponsabiliCommesse([]);
        setDynamicGestoriForniture([]);
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

  // Calcolo ruoli derivati
  const realEmail = user?.email?.toLowerCase().trim() || '';
  // isRealDev: riservato ESCLUSIVAMENTE a Emanuele Bartalucci (Lead Developer)
  // Consente l'abilitazione e l'uso dello strumento di simulazione utente (DevImpersonator)
  const isRealDev = realEmail.includes('bartalucci') || realEmail.includes('synerg');
  const userEmail = (impersonatedEmail || realEmail).toLowerCase().trim();

  // Quando si impersonifica un utente, isDev valuta SOLO l'email simulata (userEmail),
  // così che la simulazione mostri l'esatta esperienza e permessi dell'utente impersonificato.
  const isDev = isDevEmail(userEmail, dynamicDevs);
  const isSocio = userEmail.includes('aprofeti') || userEmail.includes('mcorbellini') || userEmail.includes('profeti') || userEmail.includes('corbellini');

  // isLeadDevActive: attivo solo per il Lead Developer (Emanuele Bartalucci) quando NON sta simulando un altro utente.
  // In questa modalità ordinaria, i ruoli operativi aziendali (Admin, Gestione Catalogo Commesse, HR, Commerciale, Forniture)
  // rimangono disattivati per mantenere la vista pulita da collaboratore ordinario con le sole proprie commesse assegnate.
  // Per testare o utilizzare i privilegi operativi, Emanuele utilizza "Simula Utente" (DevImpersonator).
  // Per tutti gli altri collaboratori abilitati a Sviluppatore, i ruoli operativi aziendali sono additivi e restano sempre attivi.
  const isLeadDevActive = isRealDev && !impersonatedEmail;

  const isAdmin = !isLeadDevActive && (isSocio || DEFAULT_ADMINS.some(e => e.toLowerCase().trim() === userEmail) || dynamicAdmins.some(e => e.toLowerCase().trim() === userEmail));
  const isHR = !isLeadDevActive && dynamicHrs.some(e => e.toLowerCase().trim() === userEmail);
  // isSenior è deprecato: sempre false. Usare myCoordinatedAreas (dalla collezione coordinatori) per i privilegi di area
  const isSenior = false;
  const isCommerciale = !isLeadDevActive && dynamicCommerciali.some(e => e.toLowerCase().trim() === userEmail);
  const isGestoreCommesse = !isLeadDevActive && (isAdmin || dynamicGestoriCommesse.some(e => e.toLowerCase().trim() === userEmail));
  // Gestori Forniture & Acquisti: visibile SOLO a chi è esplicitamente nominato nel ruolo
  const isGestoreForniture = !isLeadDevActive && dynamicGestoriForniture.some(e => e.toLowerCase().trim() === userEmail);

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

  const myAssociatedName = getAssociatedNameFromEmail(userEmail, dipendenti);

  // Listener real-time per priorità commesse (attivo solo quando la pianificazione è richiesta)
  useEffect(() => {
    if (!user || !isPlanningLoaded) return;
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
  }, [user, isPlanningLoaded]);

  // Listener real-time per assegnazioni commesse (attivo quando la pianificazione è richiesta)
  useEffect(() => {
    if (!user || !isPlanningLoaded) return;

    const unsubAssignments = onSnapshot(collection(db, 'assegnazioni'), (snap) => {
      const ass: Record<string, any[]> = {};
      snap.forEach(docSnap => {
        ass[docSnap.id] = docSnap.data().lista || [];
      });
      setAssegnazioni(ass);
    }, (err) => console.error("Errore listener real-time assegnazioni:", err));

    return () => unsubAssignments();
  }, [user, isPlanningLoaded]);

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
      responsabiliCommesseEmails: dynamicResponsabiliCommesse,
      gestoriFornitureEmails: dynamicGestoriForniture,
      isGestoreForniture,
      prioritaCommesse,
      isPlanningLoaded,
      loadPlanningData,
      updateCommessaPunchList,
      refreshCommesse,
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
