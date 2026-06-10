import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { Shield, UserCheck, Star, Briefcase, Users, Plus, Trash2, Settings, Printer } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { queueMail } from '../utils/mailSender';

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

const PREDEFINED_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', 
  '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#f43f5e', '#64748b'
];

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
  'Stefanelli Luca',
  'Votino Federica'
];

export function isCollaboratore(nome?: string | null, tipo?: string): boolean {
  if (tipo === 'collaboratore') return true;
  if (tipo === 'dipendente') return false;
  if (!nome) return false;
  const clean = nome.trim().toLowerCase();
  return COLLABORATORI.some(c => c.toLowerCase() === clean);
}

export const isSoci = (nome?: string | null): boolean => {
  if (!nome) return false;
  const clean = nome.trim().toLowerCase();
  return clean === 'corbellini matteo' || clean === 'profeti andrea';
};

export default function Impostazioni() {
  const { isAdmin, dipendenti, commesse } = useAuth();
  
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
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [hrEmailSelect, setHrEmailSelect] = useState('');
  const [newSeniorEmail, setNewSeniorEmail] = useState('');
  
  const [newCommessaName, setNewCommessaName] = useState('');
  const [newCommessaColor, setNewCommessaColor] = useState('#3b82f6');
  const [newCommessaDataInizio, setNewCommessaDataInizio] = useState('');
  const [newCommessaDataFine, setNewCommessaDataFine] = useState('');
  const [newCommessaResponsabile, setNewCommessaResponsabile] = useState('');
  const [newCommessaPM, setNewCommessaPM] = useState('');
  
  const [newDipNome, setNewDipNome] = useState('');
  const [newDipEmail, setNewDipEmail] = useState('');
  const [newCollabNome, setNewCollabNome] = useState('');
  const [newCollabEmail, setNewCollabEmail] = useState('');

  // Liste dinamiche da visualizzare (caricate da context o listener locali per eliminazione)
  const [adminsList, setAdminsList] = useState<{id: string, email: string}[]>([]);
  const [seniorsList, setSeniorsList] = useState<{id: string, email: string}[]>([]);
  const [emailNotificationsPaused, setEmailNotificationsPaused] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    const unsubA = onSnapshot(collection(db, 'admins'), (snap) => setAdminsList(snap.docs.map(d => ({id: d.id, email: d.data().email}))));
    const unsubS = onSnapshot(collection(db, 'seniors'), (snap) => setSeniorsList(snap.docs.map(d => ({id: d.id, email: d.data().email}))));
    const unsubH = onSnapshot(doc(db, 'configurazione_sistema', 'hr'), (doc) => {
      if(doc.exists()) setHrEmailSelect(doc.data().email);
    });
    const unsubEmail = onSnapshot(doc(db, 'configurazione_sistema', 'email'), (docSnap) => {
      if(docSnap.exists()) setEmailNotificationsPaused(docSnap.data().paused || false);
    });
    return () => { unsubA(); unsubS(); unsubH(); unsubEmail(); };
  }, [isAdmin]);

  if (!isAdmin) {
    return <div className="p-8 text-center text-gray-500">Accesso negato. Solo gli amministratori possono vedere questa pagina.</div>;
  }

  // Handlers
  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newAdminEmail) await addDoc(collection(db, 'admins'), { email: newAdminEmail.toLowerCase() });
    setNewAdminEmail('');
  };
  
  const handleRemoveAdmin = async (id: string) => {
    await deleteDoc(doc(db, 'admins', id));
  };

  const handleSaveHR = async (email: string) => {
    setHrEmailSelect(email);
    await setDoc(doc(db, 'configurazione_sistema', 'hr'), { email: email.toLowerCase() });
  };

  const handleAddSenior = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newSeniorEmail) await addDoc(collection(db, 'seniors'), { email: newSeniorEmail.toLowerCase() });
    setNewSeniorEmail('');
  };

  const handleRemoveSenior = async (id: string) => {
    await deleteDoc(doc(db, 'seniors', id));
  };

  const handleAddCommessa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommessaName || !newCommessaDataInizio || !newCommessaDataFine) {
      alert("Compila tutti i campi obbligatori per la commessa (Nome, Data Inizio e Data Fine).");
      return;
    }
    
    if (newCommessaDataInizio > newCommessaDataFine) {
      alert("La data di inizio non può essere successiva alla data di fine.");
      return;
    }

    try {
      const payload = {
        nome: newCommessaName,
        colore: newCommessaColor,
        dataInizio: newCommessaDataInizio,
        dataFine: newCommessaDataFine,
        responsabile: newCommessaResponsabile || '',
        pm: newCommessaPM || ''
      };
      
      await addDoc(collection(db, 'catalogo_commesse'), payload);
      
      // Invio email Responsabile
      if (newCommessaResponsabile) {
        const respDip = dipendenti.find(d => d.nome === newCommessaResponsabile);
        if (respDip && respDip.email) {
          const subject = `[Notifica] Abilitazione Funzioni Responsabile - Commessa ${newCommessaName}`;
          const htmlBody = `
            <p>Ciao <strong>${newCommessaResponsabile}</strong>,</p>
            <p>Sei stato assegnato come <strong>Responsabile</strong> per la nuova commessa <strong>${newCommessaName}</strong>.</p>
            <p>Periodo previsto: dal <strong>${formatDate(newCommessaDataInizio)}</strong> al <strong>${formatDate(newCommessaDataFine)}</strong>.</p>
            <p>Puoi procedere all'assegnazione e pianificazione delle risorse per questa commessa direttamente dall'applicazione.</p>
          `;
          const plainText = `Ciao ${newCommessaResponsabile},\n\nSei stato assegnato come Responsabile per la commessa ${newCommessaName}.\nPeriodo: dal ${formatDate(newCommessaDataInizio)} al ${formatDate(newCommessaDataFine)}.\n\nPuoi procedere alla pianificazione dall'applicazione.\n\nQuesta è una notifica automatica.`;
          await queueMail(respDip.email.toLowerCase(), subject, htmlBody, plainText);
        }
      }

      // Invio email PM
      if (newCommessaPM && newCommessaPM !== newCommessaResponsabile) {
        const pmDip = dipendenti.find(d => d.nome === newCommessaPM);
        if (pmDip && pmDip.email) {
          const subject = `[Notifica] Abilitazione Funzioni PM - Commessa ${newCommessaName}`;
          const htmlBody = `
            <p>Ciao <strong>${newCommessaPM}</strong>,</p>
            <p>Sei stato assegnato come <strong>Project Manager (PM)</strong> per la nuova commessa <strong>${newCommessaName}</strong>.</p>
            <p>Periodo previsto: dal <strong>${formatDate(newCommessaDataInizio)}</strong> al <strong>${formatDate(newCommessaDataFine)}</strong>.</p>
            <p>Puoi procedere al monitoraggio e pianificazione delle risorse per questa commessa dall'applicazione.</p>
          `;
          const plainText = `Ciao ${newCommessaPM},\n\nSei stato assegnato come Project Manager (PM) per la commessa ${newCommessaName}.\nPeriodo: dal ${formatDate(newCommessaDataInizio)} al ${formatDate(newCommessaDataFine)}.\n\nPuoi procedere alla pianificazione dall'applicazione.\n\nQuesta è una notifica automatica.`;
          await queueMail(pmDip.email.toLowerCase(), subject, htmlBody, plainText);
        }
      }

      setNewCommessaName('');
      setNewCommessaDataInizio('');
      setNewCommessaDataFine('');
      setNewCommessaResponsabile('');
      setNewCommessaPM('');
      alert("Commessa salvata e notifiche inviate con successo!");
    } catch (err) {
      console.error("Errore salvataggio commessa:", err);
      alert("Si è verificato un errore durante il salvataggio.");
    }
  };

  const handleRemoveCommessa = async (id: string) => {
    await deleteDoc(doc(db, 'catalogo_commesse', id));
  };

  const handleAddDipendente = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newDipNome) {
      await addDoc(collection(db, 'dipendenti'), { 
        nome: newDipNome, 
        email: newDipEmail.toLowerCase(),
        tipo: 'dipendente'
      });
      setNewDipNome('');
      setNewDipEmail('');
    }
  };

  const handleAddCollaboratore = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newCollabNome) {
      await addDoc(collection(db, 'dipendenti'), { 
        nome: newCollabNome, 
        email: newCollabEmail.toLowerCase(),
        tipo: 'collaboratore'
      });
      setNewCollabNome('');
      setNewCollabEmail('');
    }
  };

  const handleRemoveDipendente = (id: string) => {
    const target = dipendenti.find(d => d.id === id);
    if (target && isSoci(target.nome)) {
      alert("Non è possibile rimuovere un socio proprietario.");
      return;
    }

    triggerConfirm(
      "Rimuovi Dipendente",
      "Sei sicuro di voler rimuovere questo dipendente? Questa azione non cancellerà i suoi rapportini esistenti, ma non potrà più accedere.",
      async () => {
        try {
          await deleteDoc(doc(db, 'dipendenti', id));
        } catch (err) {
          console.error("Errore nella rimozione del dipendente:", err);
        }
      },
      'danger'
    );
  };

  const handlePrintCommesse = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const htmlContent = `
      <html>
        <head>
          <title>Anagrafica Clienti / Commesse</title>
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
            .color-indicator {
              display: inline-block;
              width: 16px;
              height: 16px;
              border-radius: 50%;
              vertical-align: middle;
              margin-right: 10px;
              border: 1px solid #ccc;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          </style>
        </head>
        <body>
          <h1>Anagrafica Clienti / Commesse</h1>
          <table>
            <thead>
              <tr>
                <th style="width: 15%;">#</th>
                <th style="width: 85%;">Nome Commessa / Cliente</th>
              </tr>
            </thead>
            <tbody>
              ${commesse.map((c, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>
                    <span class="color-indicator" style="background-color: ${c.colore}"></span>
                    <strong>${c.nome}</strong>
                  </td>
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
              ${dipendenti.filter(d => !isCollaboratore(d.nome, d.tipo)).map((d, index) => `
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

  return (
    <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 no-print">
      <h2 className="text-3xl font-extrabold mb-8 text-gray-900 flex items-center gap-3">
        <div className="p-3 bg-gray-100 rounded-2xl"><Settings className="w-8 h-8 text-gray-700" /></div>
        Impostazioni Piattaforma
      </h2>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* COLONNA 1 */}
        <div className="space-y-8">
          {/* Admins */}
          <section className="bg-gradient-to-br from-red-50 to-orange-50 p-6 rounded-3xl border border-red-100 shadow-sm">
            <h3 className="text-xl font-bold text-red-900 mb-4 flex items-center gap-2"><Shield className="w-6 h-6 text-red-600" /> Amministratori</h3>
            <form onSubmit={handleAddAdmin} className="flex gap-2 mb-4">
              <select required value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-red-400 transition shadow-inner font-medium text-red-900">
                <option value="">Seleziona dipendente</option>
                {dipendenti.filter(d => d.email).map(d => <option key={d.id} value={d.email}>{d.nome}</option>)}
              </select>
              <button type="submit" className="bg-red-600 text-white px-5 rounded-xl hover:bg-red-700 transition font-bold shadow-md active:scale-95">Aggiungi</button>
            </form>
            <div className="max-h-40 overflow-y-auto bg-white/50 rounded-xl divide-y border border-red-100">
              {/* Mostra sempre i Super Admin (hardcoded) */}
              {['aprofeti@ingegno06.it', 'mcorbellini@ingegno06.it'].map(email => (
                <div key={email} className="p-3 flex justify-between items-center text-sm font-medium text-red-900">
                  {email} 
                  <span className="p-1" title="Super Admin non eliminabile">
                    <Trash2 className="w-4 h-4 text-gray-300 cursor-not-allowed"/>
                  </span>
                </div>
              ))}
              
              {/* Mostra gli Admin dinamici dal database */}
              {adminsList.filter(a => a.email.toLowerCase() !== 'aprofeti@ingegno06.it' && a.email.toLowerCase() !== 'mcorbellini@ingegno06.it').map(a => (
                <div key={a.id} className="p-3 flex justify-between items-center text-sm font-medium text-red-900">
                  {a.email} 
                  <button onClick={() => handleRemoveAdmin(a.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-4 h-4"/></button>
                </div>
              ))}
            </div>
          </section>

          {/* HR */}
          <section className="bg-gradient-to-br from-purple-50 to-fuchsia-50 p-6 rounded-3xl border border-purple-100 shadow-sm">
            <h3 className="text-xl font-bold text-purple-900 mb-2 flex items-center gap-2"><UserCheck className="w-6 h-6 text-purple-600" /> Responsabile HR</h3>
            <p className="text-sm text-purple-700/80 mb-4">Gestisce le richieste di ferie e riceve le notifiche.</p>
            <select value={hrEmailSelect} onChange={e => handleSaveHR(e.target.value)} className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-purple-400 transition shadow-inner font-medium text-purple-900">
              <option value="">Nessun HR assegnato</option>
              {dipendenti.filter(d => d.email).map(d => <option key={d.id} value={d.email}>{d.nome} ({d.email})</option>)}
            </select>
          </section>

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

          {/* Seniors */}
          <section className="bg-gradient-to-br from-blue-50 to-cyan-50 p-6 rounded-3xl border border-blue-100 shadow-sm">
            <h3 className="text-xl font-bold text-blue-900 mb-2 flex items-center gap-2"><Star className="w-6 h-6 text-blue-600" /> Responsabili Senior</h3>
            <p className="text-sm text-blue-700/80 mb-4">Possono modificare i turni sulle commesse per tutti.</p>
            <form onSubmit={handleAddSenior} className="flex gap-2 mb-4">
              <select required value={newSeniorEmail} onChange={e => setNewSeniorEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-blue-400 transition shadow-inner font-medium text-blue-900">
                <option value="">Seleziona dipendente</option>
                {dipendenti.filter(d => d.email).map(d => <option key={d.id} value={d.email}>{d.nome}</option>)}
              </select>
              <button type="submit" className="bg-blue-600 text-white px-5 rounded-xl hover:bg-blue-700 transition font-bold shadow-md active:scale-95">Nomina</button>
            </form>
            <div className="max-h-40 overflow-y-auto bg-white/50 rounded-xl divide-y border border-blue-100">
              {seniorsList.map(s => (
                <div key={s.id} className="p-3 flex justify-between items-center text-sm font-medium text-blue-900">
                  {s.email} <button onClick={() => handleRemoveSenior(s.id)} className="text-blue-400 hover:text-blue-600 p-1"><Trash2 className="w-4 h-4"/></button>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* COLONNA 2 */}
        <div className="space-y-8">
          {/* Commesse */}
          <section className="bg-gradient-to-br from-emerald-50 to-teal-50 p-6 rounded-3xl border border-emerald-100 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-emerald-900 flex items-center gap-2"><Briefcase className="w-6 h-6 text-emerald-600" /> Catalogo Commesse</h3>
              <button 
                onClick={handlePrintCommesse}
                className="flex items-center gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-sm active:scale-95"
              >
                <Printer className="w-3.5 h-3.5" /> Stampa Lista
              </button>
            </div>
            
            <div className="mb-4 space-y-3 bg-white/50 p-5 rounded-2xl border border-emerald-100/50 shadow-inner">
              <form onSubmit={handleAddCommessa} className="space-y-4">
                <div className="flex gap-3 items-center">
                  <input required type="color" value={newCommessaColor} onChange={e => setNewCommessaColor(e.target.value)} className="w-12 h-12 p-1 border border-gray-200 rounded-xl bg-white cursor-pointer shadow-sm shrink-0" title="Scegli colore personalizzato" />
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-emerald-950 mb-1 ml-1">Codice / Nome Commessa</label>
                    <input required type="text" placeholder="Es. P-26-61 a" value={newCommessaName} onChange={e => setNewCommessaName(e.target.value)} className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-bold text-gray-700" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-emerald-950 mb-1 ml-1">Data Inizio</label>
                    <input required type="date" value={newCommessaDataInizio} onChange={e => setNewCommessaDataInizio(e.target.value)} className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-medium text-gray-600 text-xs sm:text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-emerald-950 mb-1 ml-1">Data Fine</label>
                    <input required type="date" value={newCommessaDataFine} onChange={e => setNewCommessaDataFine(e.target.value)} className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-medium text-gray-600 text-xs sm:text-sm" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-emerald-950 mb-1 ml-1">Responsabile</label>
                    <select value={newCommessaResponsabile} onChange={e => setNewCommessaResponsabile(e.target.value)} className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-medium text-gray-600 text-xs">
                      <option value="">-- Seleziona --</option>
                      {dipendenti.map(d => <option key={d.id} value={d.nome}>{d.nome}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-emerald-950 mb-1 ml-1">Project Manager (PM)</label>
                    <select value={newCommessaPM} onChange={e => setNewCommessaPM(e.target.value)} className="w-full p-2.5 border-none rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-emerald-400 outline-none font-medium text-gray-600 text-xs">
                      <option value="">-- Seleziona --</option>
                      {dipendenti.map(d => <option key={d.id} value={d.nome}>{d.nome}</option>)}
                    </select>
                  </div>
                </div>

                <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl transition font-bold shadow-md active:scale-95 text-sm flex items-center justify-center gap-1.5 mt-2">
                  Salva Commessa
                </button>
              </form>
              
              <div className="flex gap-2 flex-wrap px-1">
                {PREDEFINED_COLORS.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewCommessaColor(color)}
                    className={`w-6 h-6 rounded-full shadow-sm transition-transform hover:scale-110 ${newCommessaColor === color ? 'ring-2 ring-offset-2 ring-emerald-500 scale-110' : ''}`}
                    style={{ backgroundColor: color }}
                    title="Usa questo colore predefinito"
                  />
                ))}
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto bg-white/50 rounded-xl divide-y border border-emerald-100">
              {commesse.map(c => (
                <div key={c.id} className="p-3 flex justify-between items-center text-sm font-medium text-emerald-900">
                  <div className="flex items-center gap-3">
                    <span className="w-4 h-4 rounded-full shadow-sm" style={{backgroundColor: c.colore}}></span>
                    {c.nome}
                  </div>
                  <button onClick={() => handleRemoveCommessa(c.id)} className="text-emerald-400 hover:text-emerald-600 p-1"><Trash2 className="w-4 h-4"/></button>
                </div>
              ))}
            </div>
          </section>

          {/* Anagrafica Dipendenti */}
          <section className="bg-gradient-to-br from-indigo-50 to-slate-50 p-6 rounded-3xl border border-indigo-100 shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-xl font-bold text-indigo-900 flex items-center gap-2"><Users className="w-6 h-6 text-indigo-600" /> Anagrafica Dipendenti</h3>
              <button 
                onClick={handlePrintDipendenti}
                className="flex items-center gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700 px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-sm active:scale-95"
              >
                <Printer className="w-3.5 h-3.5" /> Stampa Lista
              </button>
            </div>
            <p className="text-sm text-indigo-700/80 mb-4">Solo i dipendenti in questa lista possono registrarsi all'app.</p>
            <form onSubmit={handleAddDipendente} className="flex flex-col gap-3 mb-5">
              <input required type="text" placeholder="Nome Completo (es. Rossi Mario)" value={newDipNome} onChange={e => setNewDipNome(e.target.value)} className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition shadow-inner" />
              <div className="flex gap-2">
                <input required type="email" placeholder="Email Aziendale" value={newDipEmail} onChange={e => setNewDipEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition shadow-inner" />
                <button type="submit" className="bg-indigo-600 text-white px-5 rounded-xl hover:bg-indigo-700 transition font-bold shadow-md active:scale-95 flex items-center gap-1"><Plus className="w-5 h-5"/> Aggiungi</button>
              </div>
            </form>
            <div className="max-h-64 overflow-y-auto bg-white/50 rounded-xl divide-y border border-indigo-100">
              {dipendenti.filter(d => !isCollaboratore(d.nome, d.tipo)).map(d => (
                <div key={d.id} className="p-3 flex justify-between items-center text-sm">
                  <div>
                    <div className="font-bold text-indigo-900">{d.nome}</div>
                    <div className="text-xs text-indigo-600/70">{d.email || 'Nessuna email'}</div>
                  </div>
                  {isSoci(d.nome) ? (
                    <span className="text-[10px] bg-red-100 text-red-700 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider select-none" title="Socio Proprietario non eliminabile">Socio</span>
                  ) : (
                    <button onClick={() => handleRemoveDipendente(d.id)} className="text-indigo-400 hover:text-red-600 p-2 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"><Trash2 className="w-4 h-4"/></button>
                  )}
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
                className="flex items-center gap-1.5 bg-amber-600 text-white hover:bg-amber-700 px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-sm active:scale-95"
              >
                <Printer className="w-3.5 h-3.5" /> Stampa Lista
              </button>
            </div>
            <p className="text-sm text-amber-700/80 mb-4">Solo i collaboratori in questa lista possono registrarsi all'app.</p>
            <form onSubmit={handleAddCollaboratore} className="flex flex-col gap-3 mb-5">
              <input required type="text" placeholder="Nome Completo (es. Rossi Mario)" value={newCollabNome} onChange={e => setNewCollabNome(e.target.value)} className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-amber-400 transition shadow-inner" />
              <div className="flex gap-2">
                <input required type="email" placeholder="Email Aziendale" value={newCollabEmail} onChange={e => setNewCollabEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-amber-400 transition shadow-inner" />
                <button type="submit" className="bg-amber-600 text-white px-5 rounded-xl hover:bg-amber-700 transition font-bold shadow-md active:scale-95 flex items-center gap-1"><Plus className="w-5 h-5"/> Aggiungi</button>
              </div>
            </form>
            <div className="max-h-64 overflow-y-auto bg-white/50 rounded-xl divide-y border border-amber-100">
              {dipendenti.filter(d => isCollaboratore(d.nome, d.tipo)).map(d => (
                <div key={d.id} className="p-3 flex justify-between items-center text-sm">
                  <div>
                    <div className="font-bold text-amber-900">{d.nome}</div>
                    <div className="text-xs text-amber-600/70">{d.email || 'Nessuna email'}</div>
                  </div>
                  {isSoci(d.nome) ? (
                    <span className="text-[10px] bg-red-100 text-red-700 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider select-none" title="Socio Proprietario non eliminabile">Socio</span>
                  ) : (
                    <button onClick={() => handleRemoveDipendente(d.id)} className="text-amber-400 hover:text-red-600 p-2 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"><Trash2 className="w-4 h-4"/></button>
                  )}
                </div>
              ))}
            </div>
          </section>

        </div>
      </div>
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
