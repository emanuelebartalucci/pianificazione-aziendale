import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, doc, setDoc, deleteDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { Shield, UserCheck, Star, Users, Plus, Trash2, Settings, Printer, Building2, Search, ArrowRightLeft, Pencil, X } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';


const COLLABORATORI = [
  'Atanasio Daniele',
  'Biagioni Matteo',
  'Cappelli Marco',
  'Mancini Marco',
  'Marchetti Davide',
  'Menichetti Giulia',
  'Menichetti Lorenzo',
  'Panchetti Paolo',
  'Puliti Alessio',
  'Rossi Niccolò',
  'Russo Marco',
  'Signorini Leonardo',
];

export const TIPOLOGIE_COMMESSE: Record<string, string> = {
  'A': 'Autorizzazioni',
  'AE': 'Audit Energetici',
  'B': 'Bonifica siti contaminati',
  'CA': 'Consulenza ambientale',
  'CE': 'Certificazione Energetica',
  'CF': 'Corsi di formazione',
  'CO': 'Convalida/consulenza industria farmaceutica',
  'CS': 'Consulenza sicurezza aziendale',
  'DL': 'Direzione lavori',
  'E': 'Editing vari',
  'P': 'Progettazione',
  'PE': 'Perizia',
  'PR': 'Preventivi e computi metrici',
  'R': 'Rilievi',
  'RF': 'Rilievi fonometrici',
  'RI': 'Rischio idraulico',
  'S': 'Sicurezza (Servizi di CSP-CSE)',
  'SF': 'Studio di fattibilità',
  'V': 'Valutazione ambientale, integrata'
};

export function isCollaboratore(nome?: string | null, tipoOrList?: string | any[]): boolean {
  if (!nome) return false;
  const clean = nome.trim().toLowerCase();
  if (typeof tipoOrList === 'string') {
    if (tipoOrList === 'collaboratore') return true;
    if (tipoOrList === 'dipendente') return false;
  } else if (Array.isArray(tipoOrList)) {
    const found = tipoOrList.find(d => d.nome.trim().toLowerCase() === clean);
    if (found?.tipo === 'collaboratore') return true;
    if (found?.tipo === 'dipendente') return false;
  }
  return COLLABORATORI.some(c => c.toLowerCase() === clean);
}

export const isSoci = (nome?: string | null): boolean => {
  if (!nome) return false;
  const clean = nome.trim().toLowerCase();
  return clean === 'corbellini matteo' || clean === 'profeti andrea' || clean === 'matteo corbellini' || clean === 'andrea profeti';
};

export default function Impostazioni() {
  const { isAdmin, isHR, dipendenti, coordinatori, refreshData } = useAuth();
  const isAuthorized = isAdmin || isHR;
  
  // Stato per la modale di conferma personalizzata
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  const triggerConfirm = (title: string, message: string, onConfirm: () => void, type: 'danger' | 'warning' | 'info' = 'danger') => {
    setConfirmConfig({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      },
      type
    });
  };
  
  // States per i form
  const [activeTab, setActiveTab] = useState<'clienti' | 'risorse' | 'ruoli' | 'sistema'>(isAdmin ? 'clienti' : 'risorse');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newHrEmail, setNewHrEmail] = useState('');
  const [hrList, setHrList] = useState<{id: string, email: string}[]>([]);

  const [editingEmployeeAreaId, setEditingEmployeeAreaId] = useState<string | null>(null);
  
  // Collaborator editing states (unused ones removed)
  
  const [newDipNome, setNewDipNome] = useState('');
  const [newDipEmail, setNewDipEmail] = useState('');
  const [newDipMacroArea, setNewDipMacroArea] = useState('');
  const [newCollabNome, setNewCollabNome] = useState('');
  const [newCollabEmail, setNewCollabEmail] = useState('');
  const [newCollabMacroArea, setNewCollabMacroArea] = useState('');

  // Nuovi stati per Clienti e Project Manager
  const [newClientNome, setNewClientNome] = useState('');
  const [searchClientQuery, setSearchClientQuery] = useState('');
  const [clientiList, setClientiList] = useState<{id: string, codice: string, nome: string}[]>([]);

  // Liste dinamiche da visualizzare (caricate da context o listener locali per eliminazione)
  const [adminsList, setAdminsList] = useState<{id: string, email: string}[]>([]);
  const [emailNotificationsPaused, setEmailNotificationsPaused] = useState(false);
  const [newPmEmail, setNewPmEmail] = useState('');
  const [newCommercialeEmail, setNewCommercialeEmail] = useState('');
  const [pmsList, setPmsList] = useState<{id: string, email: string}[]>([]);
  const [commercialiList, setCommercialiList] = useState<{id: string, email: string}[]>([]);

  useEffect(() => {
    if (!isAdmin) return;
    const unsubA = onSnapshot(collection(db, 'admins'), (snap) => setAdminsList(snap.docs.map(d => ({id: d.id, email: d.data().email}))));
    const unsubH = onSnapshot(collection(db, 'hr'), (snap) => {
      setHrList(snap.docs.map(d => ({ id: d.id, email: d.data().email || '' })).filter(x => x.email));
    });
    const unsubEmail = onSnapshot(doc(db, 'configurazione_sistema', 'email'), (docSnap) => {
      if(docSnap.exists()) setEmailNotificationsPaused(docSnap.data().paused || false);
    });
    const unsubC = onSnapshot(collection(db, 'clienti'), (snap) => {
      setClientiList(snap.docs.map(d => ({
        id: d.id,
        codice: d.data().codice,
        nome: d.data().nome
      })).sort((a, b) => Number(a.codice) - Number(b.codice)));
    });
    const unsubPM = onSnapshot(collection(db, 'project_managers'), (snap) => {
      setPmsList(snap.docs.map(d => ({ id: d.id, email: d.data().email || '' })).filter(x => x.email));
    });
    const unsubComm = onSnapshot(collection(db, 'commerciali'), (snap) => {
      setCommercialiList(snap.docs.map(d => ({ id: d.id, email: d.data().email || '' })).filter(x => x.email));
    });
    return () => { unsubA(); unsubH(); unsubEmail(); unsubC(); unsubPM(); unsubComm(); };
  }, [isAdmin]);

  if (!isAuthorized) {
    return <div className="p-8 text-center text-gray-500">Accesso negato. Solo gli amministratori o gli HR possono vedere questa pagina.</div>;
  }

  // Handlers
  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newAdminEmail) {
      await addDoc(collection(db, 'admins'), { email: newAdminEmail.toLowerCase() });
      await refreshData();
    }
    setNewAdminEmail('');
  };
  
  const handleRemoveAdmin = async (id: string) => {
    await deleteDoc(doc(db, 'admins', id));
    await refreshData();
  };

  const handleAddHR = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newHrEmail) {
      if (hrList.some(h => h.email.toLowerCase() === newHrEmail.toLowerCase())) {
        showToast("Questo dipendente è già un HR.", "warning");
        return;
      }
      await addDoc(collection(db, 'hr'), { email: newHrEmail.toLowerCase() });
      await refreshData();
      setNewHrEmail('');
    }
  };

  const handleRemoveHR = async (id: string) => {
    await deleteDoc(doc(db, 'hr', id));
    await refreshData();
  };



  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientNome.trim()) {
      showToast("Inserisci la ragione sociale del cliente.", "warning");
      return;
    }
    const maxCode = clientiList.reduce((max, c) => {
      const num = parseInt(c.codice);
      return !isNaN(num) && num > max ? num : max;
    }, -1);
    const nextCode = (maxCode + 1).toString();
    try {
      await setDoc(doc(db, 'clienti', nextCode), {
        codice: nextCode,
        nome: newClientNome.trim()
      });
      setNewClientNome('');
      showToast("Cliente creato con successo!", "success");
    } catch (err) {
      console.error("Errore creazione cliente:", err);
      showToast("Si è verificato un errore durante la creazione del cliente.", "error");
    }
  };

  const handleRemoveClient = async (id: string) => {
    triggerConfirm(
      "Rimuovi Cliente",
      "Sei sicuro di voler rimuovere questo cliente dall'anagrafica?",
      async () => {
        try {
          await deleteDoc(doc(db, 'clienti', id));
        } catch (err) {
          console.error("Errore rimozione cliente:", err);
          showToast("Si è verificato un errore durante la rimozione.", "error");
        }
      }
    );
  };

  const handleAddDipendente = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newDipNome) {
      await addDoc(collection(db, 'dipendenti'), { 
        nome: newDipNome, 
        email: newDipEmail.toLowerCase(),
        tipo: 'dipendente',
        macroArea: newDipMacroArea || null
      });
      await refreshData();
      setNewDipNome('');
      setNewDipEmail('');
      setNewDipMacroArea('');
    }
  };

  const handleAddCollaboratore = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newCollabNome) {
      await addDoc(collection(db, 'dipendenti'), { 
        nome: newCollabNome, 
        email: newCollabEmail.toLowerCase(),
        tipo: 'collaboratore',
        macroArea: newCollabMacroArea || null
      });
      await refreshData();
      setNewCollabNome('');
      setNewCollabEmail('');
      setNewCollabMacroArea('');
    }
  };

  const handleUpdateMacroArea = async (id: string, newArea: string) => {
    try {
      const docRef = doc(db, 'dipendenti', id);
      await updateDoc(docRef, { macroArea: newArea || null });
      await refreshData();
      showToast("Macro area aggiornata con successo!", "success");
    } catch (err) {
      console.error("Errore aggiornamento macro area:", err);
      showToast("Errore durante l'aggiornamento.", "error");
    }
  };

  const handleAddPM = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newPmEmail) {
      if (pmsList.some(p => p.email.toLowerCase() === newPmEmail.toLowerCase())) {
        showToast("Questo dipendente è già un PM.", "warning");
        return;
      }
      await addDoc(collection(db, 'project_managers'), { email: newPmEmail.toLowerCase() });
      await refreshData();
      setNewPmEmail('');
      showToast("Project Manager nominato con successo!", "success");
    }
  };

  const handleRemovePM = async (id: string) => {
    triggerConfirm(
      "Rimuovi PM",
      "Sei sicuro di voler revocare la nomina di questo Project Manager?",
      async () => {
        try {
          await deleteDoc(doc(db, 'project_managers', id));
          await refreshData();
          showToast("Nomina PM revocata con successo!", "success");
        } catch (err) {
          console.error("Errore rimozione PM:", err);
          showToast("Errore durante la revoca.", "error");
        }
      },
      'danger'
    );
  };

  const handleAddCommerciale = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newCommercialeEmail) {
      if (commercialiList.some(c => c.email.toLowerCase() === newCommercialeEmail.toLowerCase())) {
        showToast("Questo dipendente è già un Commerciale.", "warning");
        return;
      }
      await addDoc(collection(db, 'commerciali'), { email: newCommercialeEmail.toLowerCase() });
      await refreshData();
      setNewCommercialeEmail('');
      showToast("Commerciale nominato con successo!", "success");
    }
  };

  const handleRemoveCommerciale = async (id: string) => {
    triggerConfirm(
      "Rimuovi Commerciale",
      "Sei sicuro di voler revocare la nomina di questo Commerciale?",
      async () => {
        try {
          await deleteDoc(doc(db, 'commerciali', id));
          await refreshData();
          showToast("Nomina Commerciale revocata con successo!", "success");
        } catch (err) {
          console.error("Errore rimozione Commerciale:", err);
          showToast("Errore durante la revoca.", "error");
        }
      },
      'danger'
    );
  };

  const handleMoveEmployeeType = (id: string, newTipo: 'dipendente' | 'collaboratore') => {
    const target = dipendenti.find(d => d.id === id);
    if (target && isSoci(target.nome)) {
      showToast("Non è possibile modificare il ruolo di un socio proprietario.", "warning");
      return;
    }

    triggerConfirm(
      "Cambia Ruolo Risorsa",
      `Sei sicuro di voler spostare ${target ? target.nome : 'questa risorsa'} in ${newTipo === 'collaboratore' ? 'Collaboratori P. IVA' : 'Dipendenti'}? Lo storico di ferie, presenze e allocazioni verrà conservato.`,
      async () => {
        try {
          await updateDoc(doc(db, 'dipendenti', id), {
            tipo: newTipo
          });
          await refreshData();
          showToast(`Risorsa spostata in ${newTipo === 'collaboratore' ? 'Collaboratori P. IVA' : 'Dipendenti'} con successo!`, "success");
        } catch (err) {
          console.error("Errore nello spostamento della risorsa:", err);
          showToast("Si è verificato un errore durante lo spostamento.", "error");
        }
      },
      'info'
    );
  };

  const handleRemoveDipendente = (id: string) => {
    const target = dipendenti.find(d => d.id === id);
    if (target && isSoci(target.nome)) {
      showToast("Non è possibile rimuovere un socio proprietario.", "warning");
      return;
    }

    triggerConfirm(
      "Rimuovi Dipendente",
      "Sei sicuro di voler rimuovere questo dipendente? Questa azione non cancellerà i suoi rapportini esistenti, ma non potrà più accedere.",
      async () => {
        try {
          await deleteDoc(doc(db, 'dipendenti', id));
          await refreshData();
        } catch (err) {
          console.error("Errore nella rimozione del dipendente:", err);
        }
      },
      'danger'
    );
  };

  const handlePrintClienti = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const htmlContent = `
      <html>
        <head>
          <title>Anagrafica Clienti</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 30px;
              color: #333;
            }
            h1 {
              text-align: center;
              margin-bottom: 30px;
              font-size: 24px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 20px;
            }
            th, td {
              border: 1px solid #ccc;
              padding: 12px 15px;
              text-align: left;
            }
            th {
              background-color: #f3f4f6;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <h1>Anagrafica Clienti</h1>
          <table>
            <thead>
              <tr>
                <th style="width: 15%;">#</th>
                <th style="width: 25%;">Codice</th>
                <th style="width: 60%;">Ragione Sociale</th>
              </tr>
            </thead>
            <tbody>
              ${clientiList.map((c, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td><strong>${c.codice}</strong></td>
                  <td>${c.nome}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() {
                window.close();
              };
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const handlePrintDipendenti = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const htmlContent = `
      <html>
        <head>
          <title>Anagrafica Dipendenti</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 30px;
              color: #333;
            }
            h1 {
              text-align: center;
              margin-bottom: 30px;
              font-size: 24px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 20px;
            }
            th, td {
              border: 1px solid #ccc;
              padding: 12px 15px;
              text-align: left;
            }
            th {
              background-color: #f3f4f6;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <h1>Anagrafica Dipendenti</h1>
          <table>
            <thead>
              <tr>
                <th style="width: 15%;">#</th>
                <th style="width: 45%;">Nome Completo</th>
                <th style="width: 40%;">Email Aziendale</th>
              </tr>
            </thead>
            <tbody>
              ${dipendenti.filter(d => !isCollaboratore(d.nome, d.tipo) && !isSoci(d.nome)).map((d, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td><strong>${d.nome}</strong></td>
                  <td>${d.email || 'Nessuna email'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() {
                window.close();
              };
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const handlePrintCollaboratori = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const htmlContent = `
      <html>
        <head>
          <title>Anagrafica Collaboratori P. IVA</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 30px;
              color: #333;
            }
            h1 {
              text-align: center;
              margin-bottom: 30px;
              font-size: 24px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 20px;
            }
            th, td {
              border: 1px solid #ccc;
              padding: 12px 15px;
              text-align: left;
            }
            th {
              background-color: #f3f4f6;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <h1>Anagrafica Collaboratori P. IVA</h1>
          <table>
            <thead>
              <tr>
                <th style="width: 15%;">#</th>
                <th style="width: 45%;">Nome Completo</th>
                <th style="width: 40%;">Email Aziendale</th>
              </tr>
            </thead>
            <tbody>
              ${dipendenti.filter(d => isCollaboratore(d.nome, d.tipo)).map((d, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td><strong>${d.nome}</strong></td>
                  <td>${d.email || 'Nessuna email'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() {
                window.close();
              };
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };



  const getDipNomeFromEmail = (email: string) => {
    const dip = dipendenti.find(d => d.email?.toLowerCase() === email.toLowerCase());
    return dip ? dip.nome : email;
  };

  return (
    <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 no-print">
      <h2 className="text-3xl font-extrabold mb-8 text-gray-900 flex items-center gap-3">
        <div className="p-3 bg-gray-100 rounded-2xl"><Settings className="w-8 h-8 text-gray-700" /></div>
        Impostazioni Piattaforma
      </h2>
      
      {/* Menu a schede (Tabs) */}
      <div className="flex flex-wrap gap-2 mb-8 border-b border-gray-150 pb-4">
        {isAdmin && (
          <button
            onClick={() => setActiveTab('clienti')}
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 cursor-pointer ${
              activeTab === 'clienti'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-250'
                : 'bg-gray-50 text-gray-650 hover:bg-gray-100'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Anagrafica Clienti</span>
          </button>
        )}

        <button
          onClick={() => setActiveTab('risorse')}
          className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 cursor-pointer ${
            activeTab === 'risorse'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-250'
              : 'bg-gray-50 text-gray-650 hover:bg-gray-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Anagrafica Risorse</span>
        </button>

        {isAdmin && (
          <>
            <button
              onClick={() => setActiveTab('ruoli')}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 cursor-pointer ${
                activeTab === 'ruoli'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-250'
                  : 'bg-gray-50 text-gray-650 hover:bg-gray-100'
              }`}
            >
              <Star className="w-4 h-4" />
              <span>Ruoli & Permessi</span>
            </button>

            <button
              onClick={() => setActiveTab('sistema')}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 cursor-pointer ${
                activeTab === 'sistema'
                  ? 'bg-slate-700 text-white shadow-md shadow-slate-250'
                  : 'bg-gray-50 text-gray-650 hover:bg-gray-100'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>Sistema</span>
            </button>
          </>
        )}
      </div>

      {/* CONTENUTO SCHEDE */}
      <div>
        
        {/* TAB 2: CLIENTI */}
        {activeTab === 'clienti' && isAdmin && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Form Aggiunta */}
            <div className="lg:col-span-1">
              <section className="bg-gradient-to-br from-blue-50 to-indigo-50 p-6 rounded-3xl border border-blue-100 shadow-sm">
                <h3 className="text-xl font-bold text-blue-900 mb-2 flex items-center gap-2">
                  <Building2 className="w-6 h-6 text-blue-600" /> Nuovo Cliente
                </h3>
                <p className="text-sm text-blue-750 mb-4">Aggiungi un nuovo cliente all'anagrafica aziendale.</p>
                <form onSubmit={handleAddClient} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-blue-950 mb-1 ml-1">Codice Cliente (Progressivo)</label>
                    <input
                      type="text"
                      disabled
                      value={clientiList.length > 0
                        ? (Math.max(...clientiList.map(c => parseInt(c.codice) || 0)) + 1).toString()
                        : '0'
                      }
                      className="w-full p-2.5 border-none rounded-xl bg-gray-100 text-gray-500 font-bold text-xs text-center cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-blue-950 mb-1 ml-1">Ragione Sociale</label>
                    <input
                      required
                      type="text"
                      placeholder="Es. Borgo della Val di Cornia S.r.l."
                      value={newClientNome}
                      onChange={e => setNewClientNome(e.target.value)}
                      className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-blue-400 outline-none font-bold text-gray-700 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl transition font-bold shadow-md active:scale-95 text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" /> Aggiungi Cliente
                  </button>
                </form>
              </section>
            </div>

            {/* Rubrica */}
            <div className="lg:col-span-2">
              <section className="bg-gradient-to-br from-blue-50/40 to-indigo-50/40 p-6 rounded-3xl border border-blue-100 shadow-sm">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold text-blue-900 flex items-center gap-2">
                    <Search className="w-6 h-6 text-blue-600" /> Rubrica Clienti
                  </h3>
                  <button 
                    onClick={handlePrintClienti}
                    className="flex items-center gap-1.5 bg-blue-600 text-white hover:bg-blue-700 px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-sm active:scale-95 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" /> Stampa Lista
                  </button>
                </div>
                
                <div className="mb-4">
                  <input 
                    type="text" 
                    placeholder="Cerca cliente per codice o ragione sociale..." 
                    value={searchClientQuery} 
                    onChange={e => setSearchClientQuery(e.target.value)} 
                    className="w-full p-3 border-none rounded-xl bg-white focus:bg-white outline-none focus:ring-2 focus:ring-blue-400 transition shadow-inner font-semibold text-xs text-gray-700" 
                  />
                </div>

                <div className="max-h-[450px] overflow-auto bg-white/50 rounded-xl border border-blue-100">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-blue-100 text-blue-900 font-extrabold shadow-sm z-10">
                      <tr>
                        <th className="p-2.5 w-24">Codice</th>
                        <th className="p-2.5">Ragione Sociale</th>
                        <th className="p-2.5 w-16 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-blue-50 font-medium text-blue-950">
                      {(() => {
                        const query = searchClientQuery.toLowerCase();
                        const filtered = clientiList.filter(c =>
                          c.nome.toLowerCase().includes(query) || c.codice.includes(query)
                        );
                        if (filtered.length === 0) {
                          return (
                            <tr>
                              <td colSpan={3} className="p-8 text-center text-gray-400 font-bold italic">
                                Nessun cliente trovato.
                              </td>
                            </tr>
                          );
                        }
                        return filtered.map(c => (
                          <tr key={c.codice} className="hover:bg-blue-50/40 transition-colors">
                            <td className="p-2.5 font-bold">{c.codice}</td>
                            <td className="p-2.5 font-semibold text-gray-800">{c.nome}</td>
                            <td className="p-2.5 text-center">
                              <button
                                onClick={() => handleRemoveClient(c.id)}
                                className="text-blue-400 hover:text-red-655 p-1 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4"/>
                              </button>
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

          </div>
        )}

        {/* TAB 3: RISORSE */}
        {activeTab === 'risorse' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Anagrafica Dipendenti */}
            <section className="bg-gradient-to-br from-indigo-50 to-slate-50 p-6 rounded-3xl border border-indigo-100 shadow-sm">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-xl font-bold text-indigo-900 flex items-center gap-2"><Users className="w-6 h-6 text-indigo-600" /> Anagrafica Dipendenti</h3>
                <button 
                  onClick={handlePrintDipendenti}
                  className="flex items-center gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700 px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-sm active:scale-95 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Stampa Lista
                </button>
              </div>
              <p className="text-sm text-indigo-700/80 mb-4">Solo i dipendenti in questa lista possono registrarsi all'app.</p>
              <form onSubmit={handleAddDipendente} className="flex flex-col gap-3 mb-5">
                <input required type="text" placeholder="Nome Completo (es. Rossi Mario)" value={newDipNome} onChange={e => setNewDipNome(e.target.value)} className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition shadow-inner font-bold text-gray-700 text-xs" />
                <input required type="email" placeholder="Email Aziendale" value={newDipEmail} onChange={e => setNewDipEmail(e.target.value)} className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition shadow-inner font-bold text-gray-700 text-xs" />
                <div className="flex gap-2">
                  <select 
                    value={newDipMacroArea} 
                    onChange={e => setNewDipMacroArea(e.target.value)} 
                    className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition shadow-inner font-bold text-gray-700 text-xs"
                  >
                    <option value="">-- Seleziona Macro Area --</option>
                    <option value="Disegnatori">Disegnatori</option>
                    <option value="Ingegneria">Ingegneria</option>
                    <option value="Sicurezza Cantieri">Sicurezza Cantieri</option>
                    <option value="Consulenza Sicurezza">Consulenza Sicurezza</option>
                    <option value="Amministrazione">Amministrazione</option>
                  </select>
                  <button type="submit" className="bg-indigo-600 text-white px-5 rounded-xl hover:bg-indigo-700 transition font-bold shadow-md active:scale-95 flex items-center gap-1 cursor-pointer"><Plus className="w-5 h-5"/> Aggiungi</button>
                </div>
              </form>
              <div className="max-h-[350px] overflow-y-auto bg-white/50 rounded-xl divide-y border border-indigo-100">
                {dipendenti.filter(d => !isCollaboratore(d.nome, d.tipo) && !isSoci(d.nome)).map(d => (
                  <div key={d.id} className="p-3 flex justify-between items-center text-sm gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-indigo-900 truncate">{d.nome}</div>
                      <div className="text-xs text-indigo-600/70 truncate">{d.email || 'Nessuna email'}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select 
                        value={d.macroArea || ''} 
                        onChange={e => handleUpdateMacroArea(d.id, e.target.value)}
                        className="text-[10px] p-1.5 border border-indigo-200 rounded-lg bg-white/80 font-semibold outline-none focus:ring-1 focus:ring-indigo-500 text-gray-700"
                      >
                        <option value="">Nessuna Area</option>
                        <option value="Disegnatori">Disegnatori</option>
                        <option value="Ingegneria">Ingegneria</option>
                        <option value="Sicurezza Cantieri">Sicurezza Cantieri</option>
                        <option value="Consulenza Sicurezza">Consulenza Sicurezza</option>
                        <option value="Amministrazione">Amministr.</option>
                      </select>
                      <button 
                        type="button"
                        onClick={() => handleMoveEmployeeType(d.id, 'collaboratore')} 
                        className="text-indigo-600 hover:text-indigo-850 p-2 bg-indigo-50 hover:bg-indigo-150 rounded-lg transition-colors cursor-pointer"
                        title="Sposta in Collaboratori P. IVA"
                      >
                        <ArrowRightLeft className="w-4 h-4"/>
                      </button>
                      <button onClick={() => handleRemoveDipendente(d.id)} className="text-indigo-400 hover:text-red-600 p-2 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors cursor-pointer"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Anagrafica Collaboratori P. IVA */}
            <section className="bg-gradient-to-br from-amber-50 to-stone-50 p-6 rounded-3xl border border-amber-100 shadow-sm">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-xl font-bold text-amber-900 flex items-center gap-2"><Users className="w-6 h-6 text-amber-600" /> Anagrafica Collaboratori P. IVA</h3>
                <button 
                  onClick={handlePrintCollaboratori}
                  className="flex items-center gap-1.5 bg-amber-600 text-white hover:bg-amber-700 px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-sm active:scale-95 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Stampa Lista
                </button>
              </div>
              <p className="text-sm text-amber-700/80 mb-4">Solo i collaboratori in questa lista possono registrarsi all'app.</p>
              <form onSubmit={handleAddCollaboratore} className="flex flex-col gap-3 mb-5">
                <input required type="text" placeholder="Nome Completo (es. Rossi Mario)" value={newCollabNome} onChange={e => setNewCollabNome(e.target.value)} className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-amber-400 transition shadow-inner font-bold text-gray-700 text-xs" />
                <input required type="email" placeholder="Email Aziendale" value={newCollabEmail} onChange={e => setNewCollabEmail(e.target.value)} className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-amber-400 transition shadow-inner font-bold text-gray-700 text-xs" />
                <div className="flex gap-2">
                  <select 
                    value={newCollabMacroArea} 
                    onChange={e => setNewCollabMacroArea(e.target.value)} 
                    className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-amber-400 transition shadow-inner font-bold text-gray-700 text-xs"
                  >
                    <option value="">-- Seleziona Macro Area --</option>
                    <option value="Disegnatori">Disegnatori</option>
                    <option value="Ingegneria">Ingegneria</option>
                    <option value="Sicurezza Cantieri">Sicurezza Cantieri</option>
                    <option value="Consulenza Sicurezza">Consulenza Sicurezza</option>
                    <option value="Amministrazione">Amministrazione</option>
                  </select>
                  <button type="submit" className="bg-amber-600 text-white px-5 rounded-xl hover:bg-amber-700 transition font-bold shadow-md active:scale-95 flex items-center gap-1 cursor-pointer"><Plus className="w-5 h-5"/> Aggiungi</button>
                </div>
              </form>
              <div className="max-h-[350px] overflow-y-auto bg-white/50 rounded-xl divide-y border border-amber-100">
                {dipendenti.filter(d => isCollaboratore(d.nome, d.tipo) && !isSoci(d.nome)).map(d => (
                  <div key={d.id} className="p-3 flex justify-between items-center text-sm gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-amber-900 truncate">{d.nome}</div>
                      <div className="text-xs text-amber-600/70 truncate">{d.email || 'Nessuna email'}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select 
                        value={d.macroArea || ''} 
                        onChange={e => handleUpdateMacroArea(d.id, e.target.value)}
                        className="text-[10px] p-1.5 border border-amber-200 rounded-lg bg-white/80 font-semibold outline-none focus:ring-1 focus:ring-amber-500 text-gray-700"
                      >
                        <option value="">Nessuna Area</option>
                        <option value="Disegnatori">Disegnatori</option>
                        <option value="Ingegneria">Ingegneria</option>
                        <option value="Sicurezza Cantieri">Sicurezza Cantieri</option>
                        <option value="Consulenza Sicurezza">Consulenza Sicurezza</option>
                        <option value="Amministrazione">Amministr.</option>
                      </select>
                      <button 
                        type="button"
                        onClick={() => handleMoveEmployeeType(d.id, 'dipendente')} 
                        className="text-amber-600 hover:text-amber-850 p-2 bg-amber-50 hover:bg-amber-150 rounded-lg transition-colors cursor-pointer"
                        title="Sposta in Dipendenti"
                      >
                        <ArrowRightLeft className="w-4 h-4"/>
                      </button>
                      <button onClick={() => handleRemoveDipendente(d.id)} className="text-amber-400 hover:text-red-600 p-2 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors cursor-pointer"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Soci Proprietari */}
            <section className="bg-gradient-to-br from-rose-50 to-red-50/30 p-6 rounded-3xl border border-rose-100 shadow-sm h-fit animate-in fade-in duration-300">
              <h3 className="text-xl font-bold text-rose-900 flex items-center gap-2 mb-2"><Users className="w-6 h-6 text-rose-600" /> Soci Proprietari</h3>
              <p className="text-sm text-rose-750 mb-4">Direzione aziendale in sola consultazione.</p>
              <div className="max-h-[350px] overflow-y-auto bg-white/50 rounded-xl divide-y border border-rose-100">
                {dipendenti.filter(d => isSoci(d.nome)).map(d => (
                  <div key={d.id} className="p-3 flex justify-between items-center text-sm">
                    <div>
                      <div className="font-bold text-rose-900">{d.nome}</div>
                      <div className="text-xs text-rose-600/70">{d.email || 'Nessuna email'}</div>
                    </div>
                    <span className="text-[10px] bg-rose-100 text-rose-700 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider select-none">Socio</span>
                  </div>
                ))}
              </div>
            </section>

          </div>
        )}

        {/* TAB 4: RUOLI & PERMESSI */}
        {activeTab === 'ruoli' && isAdmin && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* Amministratori */}
            <section className="bg-gradient-to-br from-red-50 to-orange-50 p-6 rounded-3xl border border-red-100 shadow-sm">
              <h3 className="text-xl font-bold text-red-900 mb-4 flex items-center gap-2"><Shield className="w-6 h-6 text-red-600" /> Amministratori</h3>
              <form onSubmit={handleAddAdmin} className="flex gap-2 mb-4">
                <select required value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-red-400 transition shadow-inner font-medium text-red-900">
                  <option value="">Seleziona dipendente</option>
                  {dipendenti.filter(d => d.email).map(d => <option key={d.id} value={d.email}>{d.nome}</option>)}
                </select>
                <button type="submit" className="bg-red-600 text-white px-5 rounded-xl hover:bg-red-700 transition font-bold shadow-md active:scale-95 cursor-pointer">Aggiungi</button>
              </form>
              <div className="max-h-80 overflow-y-auto bg-white/50 rounded-xl divide-y border border-red-100">
                {/* Mostra sempre i Super Admin (hardcoded) */}
                {['aprofeti@ingegno06.it', 'mcorbellini@ingegno06.it'].map(email => {
                  const name = getDipNomeFromEmail(email);
                  return (
                    <div key={email} className="p-3 flex justify-between items-center text-sm">
                      <div>
                        <div className="font-bold text-red-900">{name}</div>
                        <div className="text-xs text-red-700/70">{email}</div>
                      </div>
                      <span className="p-1" title="Super Admin non eliminabile">
                        <Trash2 className="w-4 h-4 text-gray-300 cursor-not-allowed"/>
                      </span>
                    </div>
                  );
                })}
                
                {/* Mostra gli Admin dinamici dal database */}
                {adminsList.filter(a => a.email.toLowerCase() !== 'aprofeti@ingegno06.it' && a.email.toLowerCase() !== 'mcorbellini@ingegno06.it').map(a => {
                  const name = getDipNomeFromEmail(a.email);
                  return (
                    <div key={a.id} className="p-3 flex justify-between items-center text-sm">
                      <div>
                        <div className="font-bold text-red-900">{name}</div>
                        <div className="text-xs text-red-700/70">{a.email}</div>
                      </div>
                      <button onClick={() => handleRemoveAdmin(a.id)} className="text-red-400 hover:text-red-600 p-1 cursor-pointer"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  );
                })}
              </div>
            </section>



            {/* HR */}
            <section className="bg-gradient-to-br from-fuchsia-50 to-pink-50 p-6 rounded-3xl border border-fuchsia-100 shadow-sm h-fit">
              <h3 className="text-xl font-bold text-fuchsia-900 mb-2 flex items-center gap-2"><UserCheck className="w-6 h-6 text-fuchsia-600" /> Responsabili HR</h3>
              <p className="text-sm text-fuchsia-750 mb-4">Gestiscono le richieste di ferie e i rapportini presenze.</p>
              <form onSubmit={handleAddHR} className="flex gap-2 mb-4">
                <select required value={newHrEmail} onChange={e => setNewHrEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-fuchsia-400 transition shadow-inner font-medium text-fuchsia-900">
                  <option value="">Seleziona dipendente</option>
                  {dipendenti.filter(d => d.email).map(d => <option key={d.id} value={d.email}>{d.nome}</option>)}
                </select>
                <button type="submit" className="bg-fuchsia-600 text-white px-5 rounded-xl hover:bg-fuchsia-700 transition font-bold shadow-md active:scale-95 cursor-pointer">Nomina</button>
              </form>
              <div className="max-h-80 overflow-y-auto bg-white/50 rounded-xl divide-y border border-fuchsia-100">
                {hrList.map(h => {
                  const name = getDipNomeFromEmail(h.email);
                  return (
                    <div key={h.id} className="p-3 flex justify-between items-center text-sm">
                      <div>
                        <div className="font-bold text-fuchsia-900">{name}</div>
                        <div className="text-xs text-fuchsia-700/70">{h.email}</div>
                      </div>
                      <button onClick={() => handleRemoveHR(h.id)} className="text-fuchsia-400 hover:text-fuchsia-600 p-1 cursor-pointer"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Project Managers */}
            <section className="bg-gradient-to-br from-blue-50 to-indigo-50/40 p-6 rounded-3xl border border-blue-100 shadow-sm h-fit">
              <h3 className="text-xl font-bold text-blue-900 mb-2 flex items-center gap-2">
                <Star className="w-6 h-6 text-blue-600" /> Project Managers (PM)
              </h3>
              <p className="text-sm text-blue-750 mb-4">Nomina o rimuovi i Project Manager abilitati a supervisionare le commesse.</p>
              <form onSubmit={handleAddPM} className="flex gap-2 mb-4">
                <select required value={newPmEmail} onChange={e => setNewPmEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-blue-400 transition shadow-inner font-medium text-blue-900">
                  <option value="">Seleziona dipendente</option>
                  {dipendenti.filter(d => d.email).map(d => <option key={d.id} value={d.email}>{d.nome}</option>)}
                </select>
                <button type="submit" className="bg-blue-600 text-white px-5 rounded-xl hover:bg-blue-700 transition font-bold shadow-md active:scale-95 cursor-pointer">Nomina</button>
              </form>
              <div className="max-h-80 overflow-y-auto bg-white/50 rounded-xl divide-y border border-blue-100">
                {pmsList.length === 0 ? (
                  <p className="p-4 text-xs text-gray-400 italic font-bold">Nessun PM nominato.</p>
                ) : (
                  pmsList.map(p => {
                    const name = getDipNomeFromEmail(p.email);
                    return (
                      <div key={p.id} className="p-3 flex justify-between items-center text-sm">
                        <div>
                          <div className="font-bold text-blue-900">{name}</div>
                          <div className="text-xs text-blue-700/70">{p.email}</div>
                        </div>
                        <button onClick={() => handleRemovePM(p.id)} className="text-blue-405 hover:text-red-655 p-1 cursor-pointer"><Trash2 className="w-4 h-4"/></button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* Commerciali */}
            <section className="bg-gradient-to-br from-amber-50 to-orange-50/40 p-6 rounded-3xl border border-amber-100 shadow-sm h-fit">
              <h3 className="text-xl font-bold text-amber-900 mb-2 flex items-center gap-2">
                <Star className="w-6 h-6 text-amber-600" /> Commerciali
              </h3>
              <p className="text-sm text-amber-750 mb-4">Nomina o rimuovi i Commerciali. Riceveranno le notifiche email all'apertura delle commesse.</p>
              <form onSubmit={handleAddCommerciale} className="flex gap-2 mb-4">
                <select required value={newCommercialeEmail} onChange={e => setNewCommercialeEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-amber-400 transition shadow-inner font-medium text-amber-900">
                  <option value="">Seleziona dipendente</option>
                  {dipendenti.filter(d => d.email).map(d => <option key={d.id} value={d.email}>{d.nome}</option>)}
                </select>
                <button type="submit" className="bg-amber-600 text-white px-5 rounded-xl hover:bg-amber-700 transition font-bold shadow-md active:scale-95 cursor-pointer">Nomina</button>
              </form>
              <div className="max-h-80 overflow-y-auto bg-white/50 rounded-xl divide-y border border-amber-100">
                {commercialiList.length === 0 ? (
                  <p className="p-4 text-xs text-gray-400 italic font-bold">Nessun Commerciale nominato.</p>
                ) : (
                  commercialiList.map(c => {
                    const name = getDipNomeFromEmail(c.email);
                    return (
                      <div key={c.id} className="p-3 flex justify-between items-center text-sm">
                        <div>
                          <div className="font-bold text-amber-900">{name}</div>
                          <div className="text-xs text-amber-700/70">{c.email}</div>
                        </div>
                        <button onClick={() => handleRemoveCommerciale(c.id)} className="text-amber-405 hover:text-red-655 p-1 cursor-pointer"><Trash2 className="w-4 h-4"/></button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
            
            {/* Gestione Appartenenza Macro Aree */}
            <section className="bg-gradient-to-br from-indigo-50 to-blue-50/40 p-6 rounded-3xl border border-indigo-100 shadow-sm md:col-span-2">
              <h3 className="text-xl font-bold text-indigo-900 mb-2 flex items-center gap-2">
                📂 Composizione Macro Aree e Assegnazione Risorse
              </h3>
              <p className="text-sm text-indigo-700/80 mb-4">
                Visualizza e sposta i dipendenti e collaboratori tra le diverse macro aree funzionali.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 h-[650px]">
                {(['Disegnatori', 'Ingegneria', 'Sicurezza Cantieri', 'Consulenza Sicurezza', 'Amministrazione'] as const).map(areaName => {
                  const areaMembers = dipendenti.filter(d => d.macroArea === areaName && !isSoci(d.nome) && !coordinatori.some(c => c.email.toLowerCase() === d.email.toLowerCase() && c.area === areaName));
                  const areaCoordinators = coordinatori.filter(c => c.area === areaName);
                  
                  return (
                    <div key={areaName} className="bg-white p-4 rounded-2xl border border-indigo-100 shadow-sm flex flex-col h-full overflow-hidden">
                      <h4 className="font-extrabold text-sm text-indigo-955 border-b pb-2 mb-3 uppercase tracking-wider flex justify-between items-center shrink-0">
                        <span>{areaName}</span>
                        <span className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full text-[10px] font-bold">
                          {areaMembers.length}
                        </span>
                      </h4>
                      
                      {/* Coordinatori di quest'area */}
                      {areaCoordinators.length > 0 && (
                        <div className="mb-4 space-y-1.5 border-b pb-3 no-print shrink-0">
                          <div className="text-[10px] font-black text-teal-800 uppercase tracking-wide flex items-center gap-1 select-none">
                            👑 Coordinatori ({areaCoordinators.length})
                          </div>
                          {areaCoordinators.map(c => {
                            const name = getDipNomeFromEmail(c.email);
                            const m = dipendenti.find(d => d.email?.toLowerCase() === c.email?.toLowerCase());
                            if (!m) return null;
                            const isEditing = editingEmployeeAreaId === m.id;
                            
                            return (
                              <div key={c.id} className="p-2 bg-gradient-to-r from-teal-50 to-emerald-50 rounded-xl border border-teal-200 flex items-center justify-between text-xs min-h-[38px] gap-2">
                                {isEditing ? (
                                  <div className="flex flex-col gap-1.5 w-full">
                                    <div className="flex items-center gap-1.5 w-full">
                                      <select
                                        autoFocus
                                        value={m.macroArea || ''}
                                        onChange={async (e) => {
                                          const newArea = e.target.value;
                                          // Rimuoviamo il coordinatore dall'area corrente
                                          await deleteDoc(doc(db, 'coordinatori', c.id));
                                          // Se l'utente imposta una nuova area, aggiorniamo la macroarea del dipendente
                                          await handleUpdateMacroArea(m.id, newArea);
                                          setEditingEmployeeAreaId(null);
                                        }}
                                        className="flex-1 p-1 border border-teal-300 rounded-lg bg-white text-[11px] font-bold text-gray-700 outline-none focus:border-teal-500"
                                      >
                                        <option value="">Nessuna Area (Rimuovi)</option>
                                        <option value="Disegnatori">Disegnatori</option>
                                        <option value="Ingegneria">Ingegneria</option>
                                        <option value="Sicurezza Cantieri">Sicurezza Cantieri</option>
                                        <option value="Consulenza Sicurezza">Consulenza Sicurezza</option>
                                        <option value="Amministrazione">Amministrazione</option>
                                      </select>
                                      
                                      <button
                                        type="button"
                                        onClick={() => setEditingEmployeeAreaId(null)}
                                        className="text-gray-455 hover:text-gray-655 p-1 bg-white hover:bg-gray-50 rounded-lg border border-gray-150 transition-all shrink-0 cursor-pointer"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                    
                                    <label className="flex items-center gap-1.5 text-[9px] font-bold text-gray-755 bg-white px-1.5 py-1 rounded-lg border border-gray-200 cursor-pointer w-fit select-none">
                                      <input
                                        type="checkbox"
                                        checked={true}
                                        onChange={async (e) => {
                                          if (!e.target.checked) {
                                            // Rimuoviamo coordinatore
                                            await deleteDoc(doc(db, 'coordinatori', c.id));
                                            await refreshData();
                                            setEditingEmployeeAreaId(null);
                                          }
                                        }}
                                        className="w-3 h-3 text-teal-650 rounded border-gray-300 cursor-pointer"
                                      />
                                      <span>Coordinatore</span>
                                    </label>
                                  </div>
                                ) : (
                                  <>
                                    <div className="truncate pr-2">
                                      <div className="font-extrabold text-teal-950 truncate" title={name}>{name}</div>
                                      <div className="text-[9px] text-teal-700/80 truncate" title={c.email}>{c.email}</div>
                                    </div>
                                    <button 
                                      onClick={() => setEditingEmployeeAreaId(m.id)} 
                                      className="text-teal-600 hover:text-teal-850 p-1 bg-white hover:bg-teal-50 rounded-lg border border-teal-200 hover:border-teal-350 transition-all shrink-0 cursor-pointer font-bold"
                                      title="Modifica ruolo/area"
                                    >
                                      <Pencil className="w-3.5 h-3.5"/>
                                    </button>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      
                      <div className="space-y-2 overflow-y-auto pr-1 scrollbar-thin flex-1">
                          {areaMembers.length === 0 ? (
                            <p className="text-xs text-gray-400 italic">Nessun membro assegnato.</p>
                          ) : (
                            areaMembers.map(m => {
                              const isEditing = editingEmployeeAreaId === m.id;
                              const isCoord = coordinatori.some(c => c.email.toLowerCase() === m.email.toLowerCase() && c.area === areaName);
                              
                              return (
                                <div key={m.id} className="p-2 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-150 flex items-center justify-between text-xs transition-colors gap-2 min-h-[38px]">
                                  {isEditing ? (
                                    <div className="flex flex-col gap-1.5 w-full">
                                      <div className="flex items-center gap-1.5 w-full">
                                        <select
                                          autoFocus
                                          value={m.macroArea || ''}
                                          onChange={async (e) => {
                                            const newArea = e.target.value;
                                            await handleUpdateMacroArea(m.id, newArea);
                                            setEditingEmployeeAreaId(null);
                                          }}
                                          className="flex-1 p-1 border border-indigo-200 rounded-lg bg-white text-[11px] font-bold text-gray-700 outline-none focus:border-indigo-400"
                                        >
                                          <option value="">Nessuna Area (Rimuovi)</option>
                                          <option value="Disegnatori">Disegnatori</option>
                                          <option value="Ingegneria">Ingegneria</option>
                                          <option value="Sicurezza Cantieri">Sicurezza Cantieri</option>
                                          <option value="Consulenza Sicurezza">Consulenza Sicurezza</option>
                                          <option value="Amministrazione">Amministrazione</option>
                                        </select>
                                        
                                        <button
                                          type="button"
                                          onClick={() => setEditingEmployeeAreaId(null)}
                                          className="text-gray-400 hover:text-gray-655 p-1 bg-white hover:bg-gray-50 rounded-lg border border-gray-150 transition-all shrink-0 cursor-pointer"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                      
                                      {m.macroArea && (
                                        <label className="flex items-center gap-1.5 text-[9px] font-bold text-gray-755 bg-white px-1.5 py-1 rounded-lg border border-gray-200 cursor-pointer w-fit select-none">
                                          <input
                                            type="checkbox"
                                            checked={isCoord}
                                            onChange={async (e) => {
                                              const currentArea = m.macroArea;
                                              if (!currentArea) return;
                                              const shouldBeCoord = e.target.checked;
                                              if (shouldBeCoord) {
                                                const docId = `${m.email.toLowerCase()}_${currentArea.replace(/ \/ /g, '_')}`;
                                                await setDoc(doc(db, 'coordinatori', docId), {
                                                  email: m.email.toLowerCase(),
                                                  area: currentArea
                                                });
                                              } else {
                                                const coordObj = coordinatori.find(c => c.email.toLowerCase() === m.email.toLowerCase() && c.area === currentArea);
                                                if (coordObj) {
                                                  await deleteDoc(doc(db, 'coordinatori', coordObj.id));
                                                }
                                              }
                                              await refreshData();
                                              setEditingEmployeeAreaId(null);
                                            }}
                                            className="w-3 h-3 text-indigo-650 rounded border-gray-300 cursor-pointer"
                                          />
                                          <span>Coordinatore</span>
                                        </label>
                                      )}
                                    </div>
                                  ) : (
                                    <>
                                      <span className="font-extrabold text-gray-700 truncate" title={m.nome}>{m.nome}</span>
                                      <button
                                        type="button"
                                        onClick={() => setEditingEmployeeAreaId(m.id)}
                                        className="text-gray-400 hover:text-indigo-650 p-1 bg-white hover:bg-indigo-50 rounded-lg border border-gray-150 hover:border-indigo-200 transition-all shrink-0 cursor-pointer"
                                        title="Sposta area o nomina coordinatore"
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                    </div>
                  );
                })}
              </div>
              
              {/* Risorse non ancora assegnate */}
              {(() => {
                const unassigned = dipendenti.filter(d => !d.macroArea && !isSoci(d.nome));
                if (unassigned.length === 0) return null;
                return (
                  <div className="mt-6 pt-6 border-t border-indigo-100">
                    <h4 className="font-extrabold text-sm text-amber-900 mb-3 uppercase tracking-wider flex items-center gap-1.5">
                      ⚠️ Risorse Non Assegnate a una Macro Area ({unassigned.length})
                    </h4>
                    <div className="flex flex-wrap gap-3">
                      {unassigned.map(m => {
                        const isEditing = editingEmployeeAreaId === m.id;
                        return (
                          <div key={m.id} className="p-2.5 bg-amber-50 hover:bg-amber-100/70 rounded-xl border border-amber-150 flex items-center justify-between text-xs transition-colors gap-2 min-h-[38px]">
                            {isEditing ? (
                              <div className="flex items-center gap-1.5 w-full">
                                <select
                                  autoFocus
                                  value=""
                                  onChange={async (e) => {
                                    const newArea = e.target.value;
                                    await handleUpdateMacroArea(m.id, newArea);
                                    setEditingEmployeeAreaId(null);
                                  }}
                                  className="flex-1 p-1 border border-amber-300 rounded-lg bg-white text-[11px] font-bold text-gray-750 outline-none focus:border-amber-400"
                                >
                                  <option value="">Assegna a...</option>
                                  <option value="Disegnatori">Disegnatori</option>
                                  <option value="Ingegneria">Ingegneria</option>
                                  <option value="Sicurezza Cantieri">Sicurezza Cantieri</option>
                                  <option value="Consulenza Sicurezza">Consulenza Sicurezza</option>
                                  <option value="Amministrazione">Amministrazione</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => setEditingEmployeeAreaId(null)}
                                  className="text-gray-400 hover:text-gray-655 p-1 bg-white hover:bg-gray-50 rounded-lg border border-gray-150 transition-all shrink-0 cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <>
                                <span className="font-extrabold text-amber-955 truncate" title={m.nome}>{m.nome}</span>
                                <button
                                  type="button"
                                  onClick={() => setEditingEmployeeAreaId(m.id)}
                                  className="text-amber-500 hover:text-amber-705 p-1 bg-white hover:bg-amber-50 rounded-lg border border-amber-200 hover:border-amber-350 transition-all shrink-0 cursor-pointer"
                                  title="Assegna a macro area"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </section>

          </div>
        )}

        {/* TAB 5: SISTEMA */}
        {activeTab === 'sistema' && isAdmin && (
          <div className="space-y-8 max-w-xl">
            {/* Configurazione Email */}
            <section className="bg-gradient-to-br from-slate-50 to-zinc-100 p-6 rounded-3xl border border-slate-200 shadow-sm">
              <h3 className="text-xl font-bold text-slate-800 mb-2 flex items-center gap-2">
                <Settings className="w-6 h-6 text-slate-600" /> Notifiche Email
              </h3>
              <p className="text-sm text-slate-500 mb-4">Gestisci lo stato globale delle notifiche e-mail automatiche.</p>
              <div className="flex items-center justify-between bg-white/60 p-4 rounded-2xl border border-slate-200/50">
                <div>
                  <div className="text-sm font-bold text-slate-800">Pausa Notifiche Email</div>
                  <div className="text-xs text-slate-500 mt-0.5">Sospende temporaneamente l'invio delle e-mail a tutti i dipendenti.</div>
                </div>
                <button 
                  type="button"
                  onClick={async () => {
                    const newVal = !emailNotificationsPaused;
                    setEmailNotificationsPaused(newVal);
                    await setDoc(doc(db, 'configurazione_sistema', 'email'), { paused: newVal });
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                    emailNotificationsPaused ? 'bg-indigo-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      emailNotificationsPaused ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </section>
          </div>
        )}

      </div>
      
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

      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        type={confirmConfig.type}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
