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

export const isSoci = (nomeOrEmail?: string | null): boolean => {
  if (!nomeOrEmail) return false;
  const clean = nomeOrEmail.trim().toLowerCase();
  return clean.includes('corbellini') || clean.includes('profeti') || clean.includes('aprofeti') || clean.includes('mcorbellini');
};

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
  gestoriFornitureEmails: string[];
  isGestoreForniture: boolean;
  prioritaCommesse: Record<string, 'Alta' | 'Standard' | 'Bassa'>;
  isPlanningLoaded: boolean;
  loadPlanningData: () => Promise<void>;
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
  const [dynamicGestoriForniture, setDynamicGestoriForniture] = useState<string[]>([]);
  const [prioritaCommesse, setPrioritaCommesse] = useState<Record<string, 'Alta' | 'Standard' | 'Bassa'>>({});
  const [isPlanningLoaded, setIsPlanningLoaded] = useState(false);
  const isPlanningLoadingRef = useRef(false);

  const fetchAuthData = async () => {
    try {
      const [
        adminsSnap,
        hrsSnap,
        devsSnap,
        gestoriSnap,
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

      // 4b. Gestori forniture & materiali
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

  // Caricamento On-Demand (Lazy Loading) e Mirato per la Pianificazione
  const loadPlanningData = async () => {
    if (isPlanningLoadingRef.current) return;
    isPlanningLoadingRef.current = true;
    try {
      const uClean = (userEmail || '').toLowerCase().trim();
      const nClean = (myAssociatedName || '').toLowerCase().trim();
      const isCoord = coordinatori.some(c => c.email && c.email.toLowerCase().trim() === uClean);
      const isSocioUser = isSocio || isSoci(myAssociatedName) || isSoci(userEmail);
      const isDirezioneOrCoord = isAdmin || isSocioUser || isCoord;

      const isPM = pmsEmails.some(e => e && e.toLowerCase().trim() === uClean);
      const isGestore = dynamicGestoriCommesse.some(e => e && e.toLowerCase().trim() === uClean);
      const isPMPuro = isPM || isGestore;

      if (isDirezioneOrCoord) {
        // Coordinatori, Soci, Admin, Dev: scaricano SOLO le commesse attualmente APERTE
        const qCommOpen = query(collection(db, 'catalogo_commesse'), where('stato', '==', 'Aperta'));
        const [commesseSnap, clientiSnap, prioritySnap, assSnap] = await Promise.all([
          getDocs(qCommOpen),
          getDocs(collection(db, 'clienti')),
          getDocs(collection(db, 'priorita_commesse')),
          getDocs(collection(db, 'assegnazioni'))
        ]);

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

      } else if (isPMPuro) {
        // PM Puri e Responsabili: scaricano SOLO le commesse in cui sono PM o Responsabile, o assegnati come risorsa
        const qCommOpen = query(collection(db, 'catalogo_commesse'), where('stato', '==', 'Aperta'));
        const [commesseSnap, clientiSnap, prioritySnap, assSnap] = await Promise.all([
          getDocs(qCommOpen),
          getDocs(collection(db, 'clienti')),
          getDocs(collection(db, 'priorita_commesse')),
          getDocs(collection(db, 'assegnazioni'))
        ]);

        const ass: Record<string, any[]> = {};
        const myAssignedCommessaIds = new Set<string>();
        assSnap.forEach(docSnap => {
          const lista = docSnap.data().lista || [];
          ass[docSnap.id] = lista;
          if (myAssociatedName && docSnap.id.startsWith(`${myAssociatedName}-`)) {
            lista.forEach((item: any) => {
              if (item.commessaId) myAssignedCommessaIds.add(item.commessaId);
            });
          }
        });
        setAssegnazioni(ass);

        const prioritaMap: Record<string, 'Alta' | 'Standard' | 'Bassa'> = {};
        prioritySnap.forEach(docSnap => {
          const data = docSnap.data();
          if (data.priorita) prioritaMap[docSnap.id] = data.priorita;
        });
        setPrioritaCommesse(prioritaMap);

        const clientiList = clientiSnap.docs.map(doc => ({
          id: doc.id,
          codice: doc.data().codice || '',
          nome: doc.data().nome || ''
        })).sort((a, b) => Number(a.codice) - Number(b.codice));
        setClienti(clientiList);

        // Filtriamo le sole commesse di competenza (dove l'utente è PM/Responsabile o assegnato)
        const myCommesseList = commesseSnap.docs
          .map(doc => ({
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
          }))
          .filter(c => {
            const resp = (c.responsabile || '').toLowerCase().trim();
            const pmArray = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
            const isResp = Boolean(nClean && resp && (resp === nClean || resp.includes(nClean) || nClean.includes(resp)));
            const isPm = pmArray.some(p => {
              const pClean = String(p || '').toLowerCase().trim();
              return pClean && ((nClean && (pClean === nClean || pClean.includes(nClean) || nClean.includes(pClean))) || (uClean && pClean === uClean));
            });
            const isAssigned = myAssignedCommessaIds.has(c.id);
            return isResp || isPm || isAssigned;
          });

        setCommesse(myCommesseList.sort((a, b) => a.nome.localeCompare(b.nome)));

      } else {
        // Utente Standard (Dipendente / Disegnatore): scarica SOLO le proprie assegnazioni e SOLO le commesse assegnate
        const ass: Record<string, any[]> = {};
        const commesseIdsSet = new Set<string>();

        if (myAssociatedName) {
          const namesToQuery = new Set<string>();
          namesToQuery.add(myAssociatedName);
          const parts = myAssociatedName.trim().split(/\s+/);
          if (parts.length === 2) {
            namesToQuery.add(`${parts[1]} ${parts[0]}`);
          }

          for (const nameCandidate of namesToQuery) {
            const qAss = query(
              collection(db, 'assegnazioni'),
              where(documentId(), '>=', `${nameCandidate}-`),
              where(documentId(), '<=', `${nameCandidate}-\uf8ff`)
            );
            const assSnap = await getDocs(qAss);
            assSnap.forEach(docSnap => {
              const lista = docSnap.data().lista || [];
              ass[docSnap.id] = lista;
              lista.forEach((item: any) => {
                if (item.commessaId) commesseIdsSet.add(item.commessaId);
              });
            });
          }
        }

        setAssegnazioni(ass);

        if (commesseIdsSet.size > 0) {
          const commesseIds = Array.from(commesseIdsSet);
          const BATCH_SIZE = 30;
          const commList: Commessa[] = [];
          for (let i = 0; i < commesseIds.length; i += BATCH_SIZE) {
            const batch = commesseIds.slice(i, i + BATCH_SIZE);
            const qComm = query(collection(db, 'catalogo_commesse'), where(documentId(), 'in', batch));
            const commSnap = await getDocs(qComm);
            commSnap.forEach(doc => {
              commList.push({
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
              });
            });
          }
          setCommesse(commList.sort((a, b) => a.nome.localeCompare(b.nome)));
        } else {
          setCommesse([]);
        }

        setClienti([]);
      }

      setIsPlanningLoaded(true);
    } catch (err) {
      console.error("Errore caricamento dati pianificazione on-demand:", err);
    } finally {
      isPlanningLoadingRef.current = false;
    }
  };

  const loadAllCommesse = async () => {
    try {
      const [allSnap, clientiSnap] = await Promise.all([
        getDocs(collection(db, 'catalogo_commesse')),
        getDocs(collection(db, 'clienti'))
      ]);
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
  // Se l'utente attivo è Sviluppatore (isDev = true), isAdmin e gli altri ruoli sono FALSE (per testarli usa "Simula Utente")
  const isAdmin = !isDev && (isSocio || DEFAULT_ADMINS.some(e => e.toLowerCase().trim() === userEmail) || dynamicAdmins.some(e => e.toLowerCase().trim() === userEmail));
  const isHR = !isDev && dynamicHrs.some(e => e.toLowerCase().trim() === userEmail);
  // isSenior è deprecato: sempre false. Usare myCoordinatedAreas (dalla collezione coordinatori) per i privilegi di area
  const isSenior = false;
  const isCommerciale = !isDev && dynamicCommerciali.some(e => e.toLowerCase().trim() === userEmail);
  const isGestoreCommesse = !isDev && (isAdmin || dynamicGestoriCommesse.some(e => e.toLowerCase().trim() === userEmail));
  // Gestori Forniture & Acquisti: visibile SOLO a chi è esplicitamente nominato nel ruolo
  const isGestoreForniture = !isDev && dynamicGestoriForniture.some(e => e.toLowerCase().trim() === userEmail);

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

  // Listener real-time per assegnazioni commesse (attivo solo quando la pianificazione è richiesta)
  useEffect(() => {
    if (!user || !isPlanningLoaded) return;

    const uClean = (userEmail || '').toLowerCase().trim();
    const isCoord = coordinatori.some(c => c.email && c.email.toLowerCase().trim() === uClean);
    const isPM = pmsEmails.some(e => e && e.toLowerCase().trim() === uClean);
    const isGestore = dynamicGestoriCommesse.some(e => e && e.toLowerCase().trim() === uClean);
    const isPrivileged = isAdmin || isSocio || isCoord || isPM || isGestore;

    let unsubAssignments: () => void;
    if (isPrivileged) {
      unsubAssignments = onSnapshot(collection(db, 'assegnazioni'), (snap) => {
        const ass: Record<string, any[]> = {};
        snap.forEach(docSnap => {
          ass[docSnap.id] = docSnap.data().lista || [];
        });
        setAssegnazioni(ass);
      }, (err) => console.error("Errore listener real-time assegnazioni:", err));
    } else if (myAssociatedName) {
      const qAss = query(
        collection(db, 'assegnazioni'),
        where(documentId(), '>=', `${myAssociatedName}-`),
        where(documentId(), '<=', `${myAssociatedName}-\uf8ff`)
      );
      unsubAssignments = onSnapshot(qAss, (snap) => {
        const ass: Record<string, any[]> = {};
        snap.forEach(docSnap => {
          ass[docSnap.id] = docSnap.data().lista || [];
        });
        setAssegnazioni(ass);
      }, (err) => console.error("Errore listener real-time assegnazioni utente:", err));
    } else {
      return;
    }

    return () => unsubAssignments();
  }, [user, isPlanningLoaded, isAdmin, isDev, isSocio, myAssociatedName, userEmail, coordinatori, pmsEmails, dynamicGestoriCommesse]);

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
      gestoriFornitureEmails: dynamicGestoriForniture,
      isGestoreForniture,
      prioritaCommesse,
      isPlanningLoaded,
      loadPlanningData,
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
