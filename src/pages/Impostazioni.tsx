import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth, isTechnicalUser } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, doc, setDoc, deleteDoc, getDocs, updateDoc } from 'firebase/firestore';
import { Shield, UserCheck, Star, Users, Plus, Trash2, Settings, Printer, Building2, Search, Pencil, X, Mail, Eye, Send, Code, Briefcase } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import AnagraficaRisorseSection from '../components/AnagraficaRisorseSection';
import { wrapMailTemplate } from '../utils/mailTemplate';
import { queueMail } from '../utils/mailSender';
import { getPrintDateString, APP_VERSION } from '../config/version';
import { 
  EMAIL_TEMPLATES_LIST, 
  loadSavedEmailTemplates, 
  saveEmailTemplates, 
  substitutePlaceholders,
  getCommesseNotificationEmails,
  saveCommesseNotificationEmails,
  getSociNotificationEmails,
  saveSociNotificationEmails
} from '../utils/emailTemplateManager';


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
  'F': 'Formazione interna',
  'G': 'Gare (Enti Pubblici e Privati)',
  'M': 'Manutenzioni ed Editing',
  'P': 'Progettazione',
  'PE': 'Perizia',
  'PR': 'Preventivi e computi metrici',
  'R': 'Rilievi',
  'RF': 'Rilievi fonometrici',
  'RI': 'Rischio idraulico',
  'S': 'Sicurezza (Servizi di CSP-CSE)',
  'SF': 'Studio di fattibilità',
  'U': 'Gestione Ufficio e Interna',
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

export const isSoci = (nomeOrEmail?: string | null): boolean => {
  if (!nomeOrEmail) return false;
  const clean = nomeOrEmail.trim().toLowerCase();
  return clean.includes('corbellini') || clean.includes('profeti') || clean.includes('aprofeti') || clean.includes('mcorbellini');
};

export default function Impostazioni() {
  const navigate = useNavigate();
  const { isDev, dipendenti, coordinatori, refreshData, userEmail } = useAuth();
  
  // Stato per l'Editor & Simulatore E-mail di Sistema
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('commessa_apertura');
  const [customTemplates, setCustomTemplates] = useState<Record<string, { subject: string; body: string }>>({});
  const [editSubject, setEditSubject] = useState<string>('');
  const [editBody, setEditBody] = useState<string>('');
  const [savingTemplate, setSavingTemplate] = useState<boolean>(false);
  const [isMailPreviewModalOpen, setIsMailPreviewModalOpen] = useState(false);
  const [sendingTestMail, setSendingTestMail] = useState(false);

  // Caricamento dei template e-mail personalizzati salvati su Firestore
  useEffect(() => {
    loadSavedEmailTemplates().then(data => {
      setCustomTemplates(data);
    });
    getCommesseNotificationEmails().then(emails => {
      setCommesseNotifyEmails(emails);
    });
    getSociNotificationEmails(dipendenti).then(emails => {
      setSociNotifyEmails(emails);
    });
  }, [dipendenti]);

  const [commesseNotifyEmails, setCommesseNotifyEmails] = useState<string[]>(['synergieflow@ingegno06.it']);
  const [newCommessaNotifyEmailInput, setNewCommessaNotifyEmailInput] = useState('');
  const [sociNotifyEmails, setSociNotifyEmails] = useState<string[]>([]);
  const [newSociNotifyEmailInput, setNewSociNotifyEmailInput] = useState('');

  const currentTmplDef = useMemo(() => {
    return EMAIL_TEMPLATES_LIST.find(t => t.id === selectedTemplateId) || EMAIL_TEMPLATES_LIST[0];
  }, [selectedTemplateId]);

  useEffect(() => {
    const custom = customTemplates[selectedTemplateId];
    setEditSubject(custom?.subject ?? currentTmplDef.defaultSubject);
    setEditBody(custom?.body ?? currentTmplDef.defaultBody);
  }, [selectedTemplateId, customTemplates, currentTmplDef]);

  const handleSaveCustomTemplate = async () => {
    setSavingTemplate(true);
    try {
      const updated = {
        ...customTemplates,
        [selectedTemplateId]: {
          subject: editSubject,
          body: editBody
        }
      };
      await saveEmailTemplates(updated);
      setCustomTemplates(updated);
      showToast("Template e-mail salvato con successo!", "success");
    } catch (err) {
      console.error("Errore salvataggio template e-mail:", err);
      showToast("Errore durante il salvataggio del template.", "error");
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleResetTemplate = () => {
    setEditSubject(currentTmplDef.defaultSubject);
    setEditBody(currentTmplDef.defaultBody);
  };

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
  const [activeTab, setActiveTab] = useState<'clienti' | 'risorse' | 'ruoli' | 'sistema'>('risorse');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newHrEmail, setNewHrEmail] = useState('');
  const [hrList, setHrList] = useState<{id: string, email: string}[]>([]);
  const [newDevEmail, setNewDevEmail] = useState('');
  const [devsList, setDevsList] = useState<{id: string, email: string}[]>([]);

  // Nuovi stati per Clienti e Project Manager
  const [newClientNome, setNewClientNome] = useState('');
  const [searchClientQuery, setSearchClientQuery] = useState('');
  const [clientiList, setClientiList] = useState<{id: string, codice: string, nome: string}[]>([]);
  const [editingClient, setEditingClient] = useState<{ id: string; codice: string; nome: string } | null>(null);
  const [editClientNome, setEditClientNome] = useState('');

  // Liste dinamiche da visualizzare
  const [adminsList, setAdminsList] = useState<{id: string, email: string}[]>([]);
  const [newPmEmail, setNewPmEmail] = useState('');
  const [pmsList, setPmsList] = useState<{id: string, email: string}[]>([]);
  const [newGestoreCommessaEmail, setNewGestoreCommessaEmail] = useState('');
  const [gestoriCommesseList, setGestoriCommesseList] = useState<{id: string, email: string}[]>([]);

  const [editingEmployeeAreaId, setEditingEmployeeAreaId] = useState<string | null>(null);
  
  const [emailSearchText, setEmailSearchText] = useState('');

  const loadImpostazioniLists = async () => {
    if (!isDev) return;
    try {
      const [snapA, snapH, snapD, snapC, snapPM, snapGC] = await Promise.all([
        getDocs(collection(db, 'admins')),
        getDocs(collection(db, 'hr')),
        getDocs(collection(db, 'sviluppatori')),
        getDocs(collection(db, 'clienti')),
        getDocs(collection(db, 'project_managers')),
        getDocs(collection(db, 'gestori_commesse'))
      ]);

      setAdminsList(snapA.docs.map(d => ({ id: d.id, email: d.data().email })));
      setHrList(snapH.docs.map(d => ({ id: d.id, email: d.data().email || '' })).filter(x => x.email));
      setDevsList(snapD.docs.map(d => ({ id: d.id, email: d.data().email || '' })).filter(x => x.email));
      setClientiList(snapC.docs.map(d => ({
        id: d.id,
        codice: d.data().codice,
        nome: d.data().nome
      })).sort((a, b) => Number(a.codice) - Number(b.codice)));
      setPmsList(snapPM.docs.map(d => ({ id: d.id, email: d.data().email || '' })).filter(x => x.email));
      setGestoriCommesseList(snapGC.docs.map(d => ({ id: d.id, email: d.data().email || '' })).filter(x => x.email));
    } catch (err) {
      console.error("Errore caricamento liste impostazioni:", err);
    }
  };

  useEffect(() => {
    loadImpostazioniLists();
  }, [isDev]);

  // Handlers
  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newAdminEmail) {
      const clean = newAdminEmail.toLowerCase().trim();
      if (adminsList.some(a => a.email.toLowerCase().trim() === clean)) {
        showToast("Questo utente è già un Amministratore.", "warning");
        return;
      }
      await addDoc(collection(db, 'admins'), { email: clean });
      await refreshData();
      await loadImpostazioniLists();
      setNewAdminEmail('');
      showToast("Amministratore aggiunto con successo!", "success");
    }
  };
  
  const handleRemoveAdmin = async (id: string) => {
    await deleteDoc(doc(db, 'admins', id));
    await refreshData();
    await loadImpostazioniLists();
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
      await loadImpostazioniLists();
      setNewHrEmail('');
    }
  };

  const handleRemoveHR = async (id: string) => {
    await deleteDoc(doc(db, 'hr', id));
    await refreshData();
    await loadImpostazioniLists();
  };

  const handleAddDev = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newDevEmail) {
      if (devsList.some(d => d.email.toLowerCase().trim() === newDevEmail.toLowerCase().trim())) {
        showToast("Questo utente è già uno Sviluppatore.", "warning");
        return;
      }
      await addDoc(collection(db, 'sviluppatori'), { email: newDevEmail.toLowerCase().trim() });
      await refreshData();
      await loadImpostazioniLists();
      setNewDevEmail('');
      showToast("Sviluppatore nominato con successo!", "success");
    }
  };

  const handleRemoveDev = async (id: string, email: string) => {
    const clean = email.toLowerCase().trim();
    if (clean === 'ebartalucci@ingegno06.it' || clean.includes('bartalucci')) {
      showToast("Lo Sviluppatore Principale non può essere rimosso.", "warning");
      return;
    }
    await deleteDoc(doc(db, 'sviluppatori', id));
    await refreshData();
    await loadImpostazioniLists();
    showToast("Sviluppatore rimosso con successo!", "success");
  };

  const handleAddGestoreCommessa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newGestoreCommessaEmail) {
      if (gestoriCommesseList.some(g => g.email.toLowerCase().trim() === newGestoreCommessaEmail.toLowerCase().trim())) {
        showToast("Questo utente è già un Gestore Commesse.", "warning");
        return;
      }
      await addDoc(collection(db, 'gestori_commesse'), { email: newGestoreCommessaEmail.toLowerCase().trim() });
      await refreshData();
      await loadImpostazioniLists();
      setNewGestoreCommessaEmail('');
      showToast("Gestore Commesse aggiunto con successo!", "success");
    }
  };

  const handleRemoveGestoreCommessa = async (id: string) => {
    await deleteDoc(doc(db, 'gestori_commesse', id));
    await refreshData();
    await loadImpostazioniLists();
    showToast("Gestore Commesse rimosso con successo!", "success");
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
      await refreshData();
      await loadImpostazioniLists();
      setNewClientNome('');
      showToast("Cliente creato con successo!", "success");
    } catch (err) {
      console.error("Errore creazione cliente:", err);
      showToast("Si è verificato un errore durante la creazione del cliente.", "error");
    }
  };

  const handleEditClient = (client: { id: string; codice: string; nome: string }) => {
    setEditingClient(client);
    setEditClientNome(client.nome);
  };

  const handleSaveClientEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient || !editClientNome.trim()) {
      showToast("Inserisci una ragione sociale valida.", "warning");
      return;
    }
    try {
      await updateDoc(doc(db, 'clienti', editingClient.id), {
        nome: editClientNome.trim()
      });
      await refreshData();
      await loadImpostazioniLists();
      showToast("Ragione sociale del cliente aggiornata con successo!", "success");
      setEditingClient(null);
    } catch (err) {
      console.error("Errore aggiornamento cliente:", err);
      showToast("Si è verificato un errore durante la modifica del cliente.", "error");
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

  const handleToggleEmailNotification = async (dipId: string, currentVal: boolean) => {
    try {
      const docRef = doc(db, 'dipendenti', dipId);
      await updateDoc(docRef, { notificheEmail: !currentVal });
      await refreshData();
      showToast("Stato notifiche e-mail aggiornato con successo!", "success");
    } catch (err) {
      console.error("Errore aggiornamento notifiche e-mail:", err);
      showToast("Errore durante l'aggiornamento dello stato.", "error");
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





  const handlePrintClienti = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const rowsHtml = clientiList.length === 0 ? `
      <tr>
        <td colspan="3" style="text-align: center; padding: 20px; color: #9ca3af; font-weight: 700;">
          Nessun cliente registrato.
        </td>
      </tr>
    ` : clientiList.map((c, idx) => {
      const rowBg = idx % 2 === 1 ? 'background-color: #f9fafb;' : 'background-color: #ffffff;';
      return `
        <tr style="${rowBg}">
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; text-align: center; font-weight: 800;">${idx + 1}</td>
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; font-weight: 800; color: #111827;">${c.codice}</td>
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; font-weight: 600; color: #374151;">${c.nome}</td>
        </tr>
      `;
    }).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="it">
      <head>
        <meta charset="UTF-8">
        <title>Anagrafica Clienti Aziendali</title>
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          * { box-sizing: border-box !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: #ffffff !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 9.5px; color: #111827; }
          
          table.main-layout { width: 100%; border-collapse: collapse; border: none; }
          table.main-layout > thead > tr > td { padding: 0; border: none; }
          table.main-layout > tbody > tr > td { padding: 0; border: none; }
          table.main-layout > tfoot > tr > td { padding: 0; border: none; }

          .header-bar { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 6px; margin-bottom: 8px; border-bottom: 2px solid #1f2937; }
          .header-logo { height: 36px; width: auto; }
          .header-title-right { text-align: right; font-size: 8.5px; font-weight: 800; color: #4b5563; text-transform: uppercase; letter-spacing: 0.5px; }
          
          .title-banner { background-color: #1f2937; color: #ffffff; padding: 6px 10px; border-radius: 5px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
          .title-banner-text { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; }
          .count-badge { background-color: rgba(255, 255, 255, 0.2); padding: 2px 7px; border-radius: 4px; font-size: 9.5px; font-weight: 900; }
          
          .filter-box { border: 1px solid #9ca3af; background-color: #f9fafb; padding: 6px 10px; border-radius: 5px; margin-bottom: 10px; font-size: 9px; font-weight: 600; color: #374151; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; }
          
          table.report-table { width: 100% !important; border-collapse: collapse !important; border: 1.5px solid #4b5563 !important; font-size: 9px !important; }
          table.report-table th { background-color: #f3f4f6 !important; color: #111827 !important; font-size: 8.5px !important; font-weight: 800 !important; text-transform: uppercase !important; letter-spacing: 0.5px !important; padding: 4.5px 6px !important; border: 1px solid #6b7280 !important; }
          table.report-table td { padding: 4px 6px !important; border: 1px solid #d1d5db !important; vertical-align: middle !important; }
          table.report-table tr { page-break-inside: avoid !important; break-inside: avoid !important; }
          
          .print-footer-static { margin-top: 10px; padding-top: 6px; padding-bottom: 4px; border-top: 1px solid #9ca3af; display: flex; justify-content: space-between; align-items: center; font-size: 8.5px; font-weight: 600; color: #4b5563; font-family: monospace; }
          .page-number::after { content: counter(page); }
        </style>
      </head>
      <body>
        <table class="main-layout">
          <thead>
            <tr>
              <td>
                <div class="header-bar">
                  <img src="/Logo.png" alt="Logo Ingegno" class="header-logo" />
                  <div class="header-title-right">INGEGNO P&C S.R.L. · ANAGRAFICA CLIENTI</div>
                </div>
                <div class="title-banner">
                  <span class="title-banner-text">ANAGRAFICA CLIENTI AZIENDALI</span>
                  <span class="count-badge">${clientiList.length} CLIENTE/I</span>
                </div>
              </td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div class="filter-box">
                  <span><strong>Data Stampa:</strong> ${getPrintDateString()}</span>
                  <span><strong>Totale Clienti Censiti:</strong> ${clientiList.length}</span>
                </div>

                <table class="report-table">
                  <thead>
                    <tr>
                      <th style="width: 10%; text-align: center;">#</th>
                      <th style="width: 25%; text-align: left;">Codice Cliente</th>
                      <th style="width: 65%; text-align: left;">Ragione Sociale</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rowsHtml}
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>
                <div class="print-footer-static">
                  <span>Piattaforma Pianificazione Aziendale</span>
                  <span>${APP_VERSION} — Data Stampa: ${getPrintDateString()}</span>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>

        <script>
          function closeWindow() { try { window.close(); } catch(e) {} }
          window.onafterprint = closeWindow;
          window.onload = function() { setTimeout(function() { window.print(); closeWindow(); setTimeout(closeWindow, 500); }, 250); };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const getDipNomeFromEmail = (email?: string | null) => {
    if (!email) return 'N/D';
    const clean = email.toLowerCase().trim();
    const dip = dipendenti.find(d => (d.email || '').toLowerCase().trim() === clean);
    return dip ? dip.nome : email;
  };

  const sortedDipendentiWithEmail = useMemo(() => {
    return [...(dipendenti || [])]
      .filter(d => d && d.email && !isTechnicalUser(d))
      .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'it'));
  }, [dipendenti]);

  const sortedDevsList = useMemo(() => {
    const mainDev = {
      id: 'ebartalucci-main',
      email: 'ebartalucci@ingegno06.it',
      name: getDipNomeFromEmail('ebartalucci@ingegno06.it')
    };
    const dynamicDevsFormatted = devsList
      .filter(d => d.email.toLowerCase().trim() !== 'ebartalucci@ingegno06.it')
      .map(d => ({
        id: d.id,
        email: d.email,
        name: getDipNomeFromEmail(d.email)
      }));
    return [mainDev, ...dynamicDevsFormatted].sort((a, b) => a.name.localeCompare(b.name, 'it'));
  }, [devsList, dipendenti]);

  const sortedAdminsList = useMemo(() => {
    const superAdmins = ['aprofeti@ingegno06.it', 'mcorbellini@ingegno06.it'].map(email => ({
      id: email,
      email,
      name: getDipNomeFromEmail(email),
      isSuperAdmin: true
    }));

    const devEmails = sortedDevsList.map(d => d.email.toLowerCase().trim());

    const dynamicAdmins = adminsList
      .filter(a => a.email.toLowerCase().trim() !== 'aprofeti@ingegno06.it' && a.email.toLowerCase().trim() !== 'mcorbellini@ingegno06.it' && !devEmails.includes(a.email.toLowerCase().trim()))
      .map(a => ({
        id: a.id,
        email: a.email,
        name: getDipNomeFromEmail(a.email),
        isSuperAdmin: false
      }));

    return [...superAdmins, ...dynamicAdmins].sort((a, b) => a.name.localeCompare(b.name, 'it'));
  }, [adminsList, dipendenti, sortedDevsList]);

  const sortedHRList = useMemo(() => {
    return hrList
      .map(h => ({
        id: h.id,
        email: h.email,
        name: getDipNomeFromEmail(h.email)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'it'));
  }, [hrList, dipendenti]);

  const sortedPMsList = useMemo(() => {
    return pmsList
      .map(p => ({
        id: p.id,
        email: p.email,
        name: getDipNomeFromEmail(p.email)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'it'));
  }, [pmsList, dipendenti]);

  const sortedGestoriCommesseList = useMemo(() => {
    return gestoriCommesseList
      .map(g => ({
        id: g.id,
        email: g.email,
        name: getDipNomeFromEmail(g.email)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'it'));
  }, [gestoriCommesseList, dipendenti]);

  const maxCoordinatorsCount = useMemo(() => {
    const counts = (['Disegnatori', 'Ingegneria', 'Sicurezza Cantieri', 'Consulenza Sicurezza', 'Amministrazione'] as const).map(
      areaName => (coordinatori || []).filter((c: any) => c.area === areaName).length
    );
    return Math.max(1, ...counts);
  }, [coordinatori]);

  if (!isDev) {
    return (
      <div className="p-8 text-center bg-white rounded-3xl border border-gray-200 shadow-sm max-w-lg mx-auto my-12 animate-in fade-in zoom-in-95">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 font-black text-2xl">
          🔒
        </div>
        <h3 className="text-xl font-extrabold text-gray-900 mb-2">Accesso Riservato agli Sviluppatori</h3>
        <p className="text-xs text-gray-500 font-semibold leading-relaxed mb-6">
          La gestione delle Impostazioni di sistema è riservata esclusivamente agli Sviluppatori della piattaforma.
        </p>
        <button 
          type="button"
          onClick={() => navigate('/')} 
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-md transition cursor-pointer"
        >
          Torna alla Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 no-print">
      <h2 className="text-3xl font-extrabold mb-8 text-gray-900 flex items-center gap-3">
        <div className="p-3 bg-gray-100 rounded-2xl"><Settings className="w-8 h-8 text-gray-700" /></div>
        Impostazioni Piattaforma
      </h2>
      
      {/* Menu a schede (Tabs) */}
      <div className="flex flex-wrap gap-2 mb-8 border-b border-gray-150 pb-4">
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

        {isDev && (
          <>
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
        {activeTab === 'clienti' && isDev && (
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
                                type="button"
                                onClick={() => handleEditClient(c)}
                                className="text-blue-600 hover:text-blue-800 p-1.5 hover:bg-blue-100/60 rounded-lg transition-colors cursor-pointer"
                                title="Modifica Ragione Sociale"
                              >
                                <Pencil className="w-4 h-4"/>
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
          <div className="animate-in fade-in duration-200">
            <AnagraficaRisorseSection />
          </div>
        )}

        {/* TAB 4: RUOLI & PERMESSI */}
        {activeTab === 'ruoli' && isDev && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
              
              {/* Sviluppatori (Dev) */}
              <section className="bg-gradient-to-br from-cyan-50 to-slate-100 p-6 rounded-3xl border border-cyan-200 shadow-sm h-full flex flex-col justify-between">
                <div>
                  <h3 className="text-xl font-bold text-cyan-950 mb-1 flex items-center gap-2">
                    <Code className="w-6 h-6 text-cyan-600" /> Sviluppatori (Dev)
                  </h3>
                  <p className="text-xs text-cyan-800/80 mb-4">Hanno accesso esclusivo alla gestione e manutenzione tecnica della piattaforma.</p>
                  <form onSubmit={handleAddDev} className="flex gap-2 mb-4">
                    <select required value={newDevEmail} onChange={e => setNewDevEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-cyan-400 transition shadow-inner font-medium text-cyan-950 text-xs">
                      <option value="">Seleziona dipendente</option>
                      {sortedDipendentiWithEmail.map((d: any) => <option key={d.id} value={d.email}>{d.nome}</option>)}
                    </select>
                    <button type="submit" className="bg-cyan-700 text-white px-4 py-3 rounded-xl hover:bg-cyan-800 transition font-bold shadow-md active:scale-95 text-xs cursor-pointer">Nomina</button>
                  </form>
                </div>
                <div className="h-48 overflow-y-auto bg-white/50 rounded-xl divide-y border border-cyan-100">
                  {sortedDevsList.map((d: any) => (
                    <div key={d.id} className="p-3 flex justify-between items-center text-sm">
                      <div>
                        <div className="font-bold text-cyan-950">{d.name}</div>
                        <div className="text-xs text-cyan-700/70">{d.email}</div>
                      </div>
                      {d.email.toLowerCase().trim() === 'ebartalucci@ingegno06.it' ? (
                        <span className="p-1" title="Sviluppatore Principale non eliminabile">
                          <Trash2 className="w-4 h-4 text-gray-300 cursor-not-allowed"/>
                        </span>
                      ) : (
                        <button onClick={() => handleRemoveDev(d.id, d.email)} className="text-cyan-600 hover:text-red-600 p-1 cursor-pointer"><Trash2 className="w-4 h-4"/></button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
              
              {/* Amministratori */}
              <section className="bg-gradient-to-br from-red-50 to-orange-50 p-6 rounded-3xl border border-red-100 shadow-sm h-full flex flex-col justify-between">
                <div>
                  <h3 className="text-xl font-bold text-red-900 mb-1 flex items-center gap-2"><Shield className="w-6 h-6 text-red-600" /> Amministratori</h3>
                  <p className="text-xs text-red-750 mb-4">Hanno accesso completo a tutte le funzioni e impostazioni della piattaforma.</p>
                  <form onSubmit={handleAddAdmin} className="flex gap-2 mb-4">
                    <select required value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-red-400 transition shadow-inner font-medium text-red-900 text-xs">
                      <option value="">Seleziona dipendente</option>
                      {sortedDipendentiWithEmail
                        .filter((d: any) => !adminsList.some(a => (a.email || '').toLowerCase().trim() === (d.email || '').toLowerCase().trim()))
                        .map((d: any) => <option key={d.id} value={d.email}>{d.nome}</option>)}
                    </select>
                    <button type="submit" className="bg-red-600 text-white px-4 py-3 rounded-xl hover:bg-red-700 transition font-bold shadow-md active:scale-95 text-xs cursor-pointer">Aggiungi</button>
                  </form>
                </div>
                <div className="h-48 overflow-y-auto bg-white/50 rounded-xl divide-y border border-red-100">
                  {sortedAdminsList.map((a: any) => (
                    <div key={a.id} className="p-3 flex justify-between items-center text-sm">
                      <div>
                        <div className="font-bold text-red-900">{a.name}</div>
                        <div className="text-xs text-red-700/70">{a.email}</div>
                      </div>
                      {a.isSuperAdmin ? (
                        <span className="p-1" title="Super Admin non eliminabile">
                          <Trash2 className="w-4 h-4 text-gray-300 cursor-not-allowed"/>
                        </span>
                      ) : (
                        <button onClick={() => handleRemoveAdmin(a.id)} className="text-red-400 hover:text-red-600 p-1 cursor-pointer"><Trash2 className="w-4 h-4"/></button>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* HR */}
              <section className="bg-gradient-to-br from-fuchsia-50 to-pink-50 p-6 rounded-3xl border border-fuchsia-100 shadow-sm h-full flex flex-col justify-between">
                <div>
                  <h3 className="text-xl font-bold text-fuchsia-900 mb-1 flex items-center gap-2"><UserCheck className="w-6 h-6 text-fuchsia-600" /> Responsabili HR</h3>
                  <p className="text-xs text-fuchsia-750 mb-4">Gestiscono le richieste di ferie, i rapportini presenze e le bozze fattura.</p>
                  <form onSubmit={handleAddHR} className="flex gap-2 mb-4">
                    <select required value={newHrEmail} onChange={e => setNewHrEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-fuchsia-400 transition shadow-inner font-medium text-fuchsia-900 text-xs">
                      <option value="">Seleziona dipendente</option>
                      {sortedDipendentiWithEmail
                        .filter((d: any) => !hrList.some(h => (h.email || '').toLowerCase().trim() === (d.email || '').toLowerCase().trim()))
                        .map((d: any) => <option key={d.id} value={d.email}>{d.nome}</option>)}
                    </select>
                    <button type="submit" className="bg-fuchsia-600 text-white px-4 py-3 rounded-xl hover:bg-fuchsia-700 transition font-bold shadow-md active:scale-95 text-xs cursor-pointer">Nomina</button>
                  </form>
                </div>
                <div className="h-48 overflow-y-auto bg-white/50 rounded-xl divide-y border border-fuchsia-100">
                  {sortedHRList.map((h: any) => (
                    <div key={h.id} className="p-3 flex justify-between items-center text-sm">
                      <div>
                        <div className="font-bold text-fuchsia-900">{h.name}</div>
                        <div className="text-xs text-fuchsia-700/70">{h.email}</div>
                      </div>
                      <button onClick={() => handleRemoveHR(h.id)} className="text-fuchsia-400 hover:text-fuchsia-600 p-1 cursor-pointer"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Project Managers */}
              <section className="bg-gradient-to-br from-blue-50 to-indigo-50/40 p-6 rounded-3xl border border-blue-100 shadow-sm h-full flex flex-col justify-between">
                <div>
                  <h3 className="text-xl font-bold text-blue-900 mb-1 flex items-center gap-2">
                    <Star className="w-6 h-6 text-blue-600" /> Project Managers (PM)
                  </h3>
                  <p className="text-xs text-blue-750 mb-4">Nomina o rimuovi i Project Manager abilitati a supervisionare le commesse.</p>
                  <form onSubmit={handleAddPM} className="flex gap-2 mb-4">
                    <select required value={newPmEmail} onChange={e => setNewPmEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-blue-400 transition shadow-inner font-medium text-blue-900 text-xs">
                      <option value="">Seleziona dipendente</option>
                      {sortedDipendentiWithEmail
                        .filter((d: any) => !pmsList.some(p => (p.email || '').toLowerCase().trim() === (d.email || '').toLowerCase().trim()))
                        .map((d: any) => <option key={d.id} value={d.email}>{d.nome}</option>)}
                    </select>
                    <button type="submit" className="bg-blue-600 text-white px-4 py-3 rounded-xl hover:bg-blue-700 transition font-bold shadow-md active:scale-95 text-xs cursor-pointer">Nomina</button>
                  </form>
                </div>
                <div className="h-48 overflow-y-auto bg-white/50 rounded-xl divide-y border border-blue-100">
                  {sortedPMsList.length === 0 ? (
                    <p className="p-4 text-xs text-gray-400 italic font-bold">Nessun PM nominato.</p>
                  ) : (
                    sortedPMsList.map((p: any) => (
                      <div key={p.id} className="p-3 flex justify-between items-center text-sm">
                        <div>
                          <div className="font-bold text-blue-900">{p.name}</div>
                          <div className="text-xs text-blue-700/70">{p.email}</div>
                        </div>
                        <button onClick={() => handleRemovePM(p.id)} className="text-blue-405 hover:text-red-655 p-1 cursor-pointer"><Trash2 className="w-4 h-4"/></button>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* Gestori Commesse */}
              <section className="bg-gradient-to-br from-emerald-50 to-teal-50 p-6 rounded-3xl border border-emerald-100 shadow-sm h-full flex flex-col justify-between">
                <div>
                  <h3 className="text-xl font-bold text-emerald-950 mb-1 flex items-center gap-2">
                    <Briefcase className="w-6 h-6 text-emerald-600" /> Gestori Commesse
                  </h3>
                  <p className="text-xs text-emerald-800/80 mb-4">Abilitati ad aprire nuove commesse ed accedere al Catalogo Commesse.</p>
                  <form onSubmit={handleAddGestoreCommessa} className="flex gap-2 mb-4">
                    <select required value={newGestoreCommessaEmail} onChange={e => setNewGestoreCommessaEmail(e.target.value)} className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-emerald-400 transition shadow-inner font-medium text-emerald-950 text-xs">
                      <option value="">Seleziona dipendente</option>
                      {sortedDipendentiWithEmail
                        .filter((d: any) => !gestoriCommesseList.some(g => (g.email || '').toLowerCase().trim() === (d.email || '').toLowerCase().trim()))
                        .map((d: any) => <option key={d.id} value={d.email}>{d.nome}</option>)}
                    </select>
                    <button type="submit" className="bg-emerald-600 text-white px-4 py-3 rounded-xl hover:bg-emerald-700 transition font-bold shadow-md active:scale-95 text-xs cursor-pointer">Nomina</button>
                  </form>
                </div>
                <div className="h-48 overflow-y-auto bg-white/50 rounded-xl divide-y border border-emerald-100">
                  {sortedGestoriCommesseList.length === 0 ? (
                    <p className="p-4 text-xs text-gray-400 italic font-bold">Nessun Gestore Commesse nominato.</p>
                  ) : (
                    sortedGestoriCommesseList.map((g: any) => (
                      <div key={g.id} className="p-3 flex justify-between items-center text-sm">
                        <div>
                          <div className="font-bold text-emerald-950">{g.name}</div>
                          <div className="text-xs text-emerald-700/70">{g.email}</div>
                        </div>
                        <button onClick={() => handleRemoveGestoreCommessa(g.id)} className="text-emerald-500 hover:text-red-600 p-1 cursor-pointer"><Trash2 className="w-4 h-4"/></button>
                      </div>
                    ))
                  )}
                </div>
              </section>

            </div>
            
            {/* Gestione Appartenenza Macro Aree */}
            <section className="bg-gradient-to-br from-indigo-50 to-blue-50/40 p-6 rounded-3xl border border-indigo-100 shadow-sm md:col-span-2">
              <h3 className="text-xl font-bold text-indigo-900 mb-2 flex items-center gap-2">
                📂 Composizione Macro Aree e Assegnazione Risorse
              </h3>
              <p className="text-sm text-indigo-700/80 mb-4">
                Visualizza e sposta i dipendenti e collaboratori tra le diverse macro aree funzionali.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-stretch">
                {(['Disegnatori', 'Ingegneria', 'Sicurezza Cantieri', 'Consulenza Sicurezza', 'Amministrazione'] as const).map(areaName => {
                  const areaCoordinators = coordinatori
                    .filter(c => c && c.area === areaName && dipendenti.some(d => d.email?.toLowerCase().trim() === c.email?.toLowerCase().trim()))
                    .sort((a, b) => (getDipNomeFromEmail(a.email) || '').localeCompare(getDipNomeFromEmail(b.email) || '', 'it'));

                  const areaMembers = dipendenti
                    .filter(d => d && d.macroArea === areaName && !isSoci(d.nome) && !isTechnicalUser(d) && !areaCoordinators.some(c => (c.email || '').toLowerCase().trim() === (d.email || '').toLowerCase().trim()))
                    .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'it'));
                  
                  return (
                    <div key={areaName} className="bg-white p-4 rounded-2xl border border-indigo-100 shadow-sm flex flex-col h-full overflow-hidden">
                      <h4 className="font-extrabold text-sm text-indigo-955 border-b pb-2 mb-3 uppercase tracking-wider flex justify-between items-center shrink-0 min-h-[44px]">
                        <span className="leading-tight pr-1">{areaName}</span>
                        <span className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0">
                          {areaMembers.length + areaCoordinators.length}
                        </span>
                      </h4>
                      
                      {/* Coordinatori di quest'area con altezza dinamica perfettamente uniforme */}
                      <div className="mb-4 space-y-1.5 border-b pb-3 no-print shrink-0 flex flex-col justify-start">
                        <div className="text-[10px] font-black text-teal-800 uppercase tracking-wide flex items-center gap-1 select-none">
                          👑 Coordinatori ({areaCoordinators.length})
                        </div>
                        {areaCoordinators.map((c: any) => {
                          const name = getDipNomeFromEmail(c.email);
                          const m = dipendenti.find((d: any) => d.email?.toLowerCase() === c.email?.toLowerCase());
                          if (!m) return null;
                          const isEditing = editingEmployeeAreaId === m.id;
                          
                          return (
                            <div key={c.id} className="p-2 bg-gradient-to-r from-teal-50 to-emerald-50 rounded-xl border border-teal-200 flex items-center justify-between text-xs gap-2">
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
                        {Array.from({ length: Math.max(0, maxCoordinatorsCount - areaCoordinators.length) }).map((_, idx) => (
                          <div key={`empty-coord-spacer-${idx}`} className="p-2 border border-transparent flex items-center justify-between text-xs opacity-0 pointer-events-none select-none" aria-hidden="true">
                            <div className="truncate pr-2">
                              <div className="font-extrabold text-transparent">Placeholder</div>
                              <div className="text-[9px] text-transparent">placeholder@email.it</div>
                            </div>
                            <div className="w-5 h-5" />
                          </div>
                        ))}
                      </div>
                      
                      <div className="space-y-2 flex-1">
                          {areaMembers.length === 0 ? (
                            <p className="text-xs text-gray-400 italic">Nessun membro assegnato.</p>
                          ) : (
                            areaMembers.map(m => {
                              const isEditing = editingEmployeeAreaId === m.id;
                              const isCoord = (coordinatori || []).some(c => (c.email || '').toLowerCase() === (m.email || '').toLowerCase() && c.area === areaName);
                              
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
                                              const mEmailClean = (m.email || m.id).toLowerCase();
                                              if (shouldBeCoord) {
                                                const docId = `${mEmailClean}_${currentArea.replace(/ \/ /g, '_')}`;
                                                await setDoc(doc(db, 'coordinatori', docId), {
                                                  email: mEmailClean,
                                                  area: currentArea
                                                });
                                              } else {
                                                const coordObj = (coordinatori || []).find(c => (c.email || '').toLowerCase() === mEmailClean && c.area === currentArea);
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
        {activeTab === 'sistema' && isDev && (
          <div className="space-y-8 w-full">
            {/* Configurazione Email Risorse */}
            <section className="bg-gradient-to-br from-slate-50 to-zinc-100 p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-slate-800 mb-1 flex items-center gap-2">
                  <Mail className="w-6 h-6 text-indigo-650" /> Notifiche Email Risorse
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed mb-4">
                  Abilita o disabilita singolarmente le risorse a ricevere e-mail dal sistema per i canali attivi (solleciti e note di correzione presenze da parte dell'HR e notifiche di apertura commessa).
                </p>
                
                {/* Filtro Ricerca Risorsa */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Cerca risorsa..."
                    value={emailSearchText}
                    onChange={e => setEmailSearchText(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 text-xs font-semibold text-slate-700 shadow-sm"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              {/* Lista delle Risorse con Scrollbar */}
              <div className="h-56 overflow-y-auto border border-slate-200/60 rounded-2xl bg-white divide-y divide-slate-100 shadow-inner">
                {(() => {
                  const todayStr = new Date().toISOString().split('T')[0];
                  const filtered = dipendenti
                    .filter(dip => !dip.dataCessazione || dip.dataCessazione > todayStr)
                    .filter(dip => 
                      dip.nome.toLowerCase().includes(emailSearchText.toLowerCase()) || 
                      (dip.email || '').toLowerCase().includes(emailSearchText.toLowerCase())
                    );

                  if (filtered.length === 0) {
                    return (
                      <div className="p-8 text-center text-xs text-slate-400 italic font-semibold">
                        Nessun dipendente trovato.
                      </div>
                    );
                  }

                  return filtered.map(dip => {
                    const isEmailEnabled = dip.notificheEmail === true;

                    return (
                      <div key={dip.id} className="flex items-center justify-between p-3 hover:bg-slate-50/50 transition-colors">
                        <div className="min-w-0 pr-4">
                          <div className="text-xs font-bold text-slate-800 truncate">{dip.nome}</div>
                          <div className="text-[10px] text-slate-400 font-semibold truncate mt-0.5">{dip.email}</div>
                        </div>
                        <button 
                          type="button"
                          onClick={() => handleToggleEmailNotification(dip.id, isEmailEnabled)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                            isEmailEnabled ? 'bg-indigo-600' : 'bg-gray-200'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              isEmailEnabled ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  });
                })()}
              </div>
            </section>

            {/* Destinatari Notifiche Commesse & Clienti */}
            <section className="bg-gradient-to-br from-emerald-50/80 to-teal-50 p-6 rounded-3xl border border-emerald-200 shadow-sm space-y-5">
              <div className="border-b border-emerald-200/60 pb-3">
                <h3 className="text-xl font-bold text-emerald-950 flex items-center gap-2">
                  <Mail className="w-6 h-6 text-emerald-600" /> Destinatari Notifiche Commesse & Clienti
                </h3>
                <p className="text-xs text-emerald-800/80 mt-1">
                  Aggiungi o rimuovi gli indirizzi e-mail a cui inviare le notifiche automatiche quando viene <strong>aperta</strong> o <strong>chiusa</strong> una commessa o viene inserito un <strong>nuovo cliente</strong> in anagrafica. Ogni modifica viene salvata automaticamente.
                </p>
              </div>

              {/* Form per inserire un nuovo indirizzo con Invio o Pulsante */}
              <form 
                onSubmit={async (e) => {
                  e.preventDefault();
                  const targetEmail = newCommessaNotifyEmailInput.toLowerCase().trim();
                  if (!targetEmail) {
                    showToast("Inserisci un indirizzo e-mail valido.", "warning");
                    return;
                  }
                  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
                    showToast("Il formato dell'indirizzo e-mail non è valido.", "warning");
                    return;
                  }
                  if (commesseNotifyEmails.includes(targetEmail)) {
                    showToast("Questo indirizzo e-mail è già presente nell'elenco.", "warning");
                    return;
                  }

                  const updatedList = Array.from(new Set([...commesseNotifyEmails, targetEmail]));
                  setCommesseNotifyEmails(updatedList);
                  setNewCommessaNotifyEmailInput('');

                  try {
                    await saveCommesseNotificationEmails(updatedList);
                    showToast(`Indirizzo ${targetEmail} aggiunto e salvato con successo!`, "success");
                  } catch (err) {
                    console.error("Errore salvataggio automatico email:", err);
                    showToast("Errore durante il salvataggio automatico dell'indirizzo.", "error");
                  }
                }}
                className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center"
              >
                <input
                  type="email"
                  placeholder="Es. synergieflow@ingegno06.it"
                  value={newCommessaNotifyEmailInput}
                  onChange={e => setNewCommessaNotifyEmailInput(e.target.value)}
                  className="flex-1 px-4 py-2.5 bg-white border border-emerald-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm"
                />
                <button
                  type="submit"
                  className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-4 py-2.5 rounded-xl transition text-xs flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Aggiungi Indirizzo
                </button>
              </form>

              {/* Elenco indirizzi censiti coordinato con il tab Ruoli & Permessi */}
              <div className="bg-white rounded-2xl border border-emerald-200/80 shadow-xs overflow-hidden divide-y divide-emerald-100/80">
                {commesseNotifyEmails.length === 0 ? (
                  <div className="p-4 text-xs text-slate-400 italic font-medium text-center">
                    Nessun indirizzo e-mail presente nell'elenco dei destinatari.
                  </div>
                ) : (
                  commesseNotifyEmails.map((email, idx) => {
                    const cleanEmail = email.toLowerCase().trim();
                    const isSystem = cleanEmail === 'synergieflow@ingegno06.it' || cleanEmail === 'synergiesflow@ingegno06.it';
                    const dipObj = dipendenti.find(d => (d.email || '').toLowerCase().trim() === cleanEmail);
                    const labelName = isSystem ? 'Synergie Flow (Email Generica di Sistema)' : (dipObj ? dipObj.nome : cleanEmail);

                    return (
                      <div key={idx} className="p-3 sm:p-3.5 flex justify-between items-center text-xs hover:bg-emerald-50/40 transition-colors">
                        <div className="flex items-center gap-3 min-w-0 pr-2">
                          <div className={`p-2 rounded-xl shrink-0 ${isSystem ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            <Mail className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-extrabold text-slate-900 text-xs sm:text-sm truncate" title={labelName}>{labelName}</div>
                            <div className="text-[11px] text-slate-500 font-semibold truncate" title={email}>{email}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            const updatedList = commesseNotifyEmails.filter((_, i) => i !== idx);
                            setCommesseNotifyEmails(updatedList);
                            try {
                              await saveCommesseNotificationEmails(updatedList);
                              showToast(`Indirizzo ${email} rimosso con successo!`, "success");
                            } catch (err) {
                              console.error("Errore rimozione email:", err);
                              showToast("Errore durante la rimozione dell'indirizzo.", "error");
                            }
                          }}
                          className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-2 rounded-xl transition cursor-pointer shrink-0"
                          title="Rimuovi questo indirizzo"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* Destinatari Notifiche Lavoro Weekend & Festivi */}
            <section className="bg-gradient-to-br from-indigo-50/80 to-blue-50 p-6 rounded-3xl border border-indigo-200 shadow-sm space-y-5">
              <div className="border-b border-indigo-200/60 pb-3">
                <h3 className="text-xl font-bold text-indigo-950 flex items-center gap-2">
                  <Mail className="w-6 h-6 text-indigo-600" /> Destinatari Notifiche Lavoro Weekend & Festivi
                </h3>
                <p className="text-xs text-indigo-800/80 mt-1">
                  Elenco degli indirizzi e-mail che ricevono automaticamente una notifica via mail quando viene <strong>approvata</strong> una richiesta di lavoro straordinario nel weekend o nei giorni festivi.
                </p>
              </div>

              {/* Form per aggiungere un nuovo indirizzo */}
              <form 
                onSubmit={async (e) => {
                  e.preventDefault();
                  const targetEmail = newSociNotifyEmailInput.toLowerCase().trim();
                  if (!targetEmail) {
                    showToast("Inserisci un indirizzo e-mail valido.", "warning");
                    return;
                  }
                  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
                    showToast("Il formato dell'indirizzo e-mail non è valido.", "warning");
                    return;
                  }
                  if (sociNotifyEmails.includes(targetEmail)) {
                    showToast("Questo indirizzo e-mail è già presente nell'elenco.", "warning");
                    return;
                  }

                  const updatedList = Array.from(new Set([...sociNotifyEmails, targetEmail]));
                  setSociNotifyEmails(updatedList);
                  setNewSociNotifyEmailInput('');

                  try {
                    await saveSociNotificationEmails(updatedList);
                    showToast(`Indirizzo ${targetEmail} aggiunto e salvato con successo!`, "success");
                  } catch (err) {
                    console.error("Errore salvataggio automatico email:", err);
                    showToast("Errore durante il salvataggio automatico dell'indirizzo.", "error");
                  }
                }}
                className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center"
              >
                <input
                  type="email"
                  placeholder="Es. mcorbellini@ingegno06.it"
                  value={newSociNotifyEmailInput}
                  onChange={e => setNewSociNotifyEmailInput(e.target.value)}
                  className="flex-1 px-4 py-2.5 bg-white border border-indigo-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                />
                <button
                  type="submit"
                  className="bg-indigo-700 hover:bg-indigo-800 text-white font-bold px-4 py-2.5 rounded-xl transition text-xs flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Aggiungi Destinatario
                </button>
              </form>

              {/* Elenco indirizzi censiti */}
              <div className="bg-white rounded-2xl border border-indigo-200/80 shadow-xs overflow-hidden divide-y divide-indigo-100/80">
                {sociNotifyEmails.length === 0 ? (
                  <div className="p-4 text-xs text-slate-400 italic font-medium text-center">
                    Nessun indirizzo e-mail configurato per le notifiche festivi.
                  </div>
                ) : (
                  sociNotifyEmails.map((email, idx) => {
                    const cleanEmail = email.toLowerCase().trim();
                    const dipObj = dipendenti.find(d => (d.email || '').toLowerCase().trim() === cleanEmail);
                    const labelName = dipObj ? dipObj.nome : cleanEmail;

                    return (
                      <div key={idx} className="p-3 sm:p-3.5 flex justify-between items-center text-xs hover:bg-indigo-50/40 transition-colors">
                        <div className="flex items-center gap-3 min-w-0 pr-2">
                          <div className="p-2 rounded-xl shrink-0 bg-indigo-100 text-indigo-700">
                            <Mail className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-extrabold text-slate-900 text-xs sm:text-sm truncate" title={labelName}>{labelName}</div>
                            <div className="text-[11px] text-slate-500 font-semibold truncate" title={email}>{email}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            const updatedList = sociNotifyEmails.filter((_, i) => i !== idx);
                            setSociNotifyEmails(updatedList);
                            try {
                              await saveSociNotificationEmails(updatedList);
                              showToast(`Indirizzo ${email} rimosso con successo!`, "success");
                            } catch (err) {
                              console.error("Errore rimozione email:", err);
                              showToast("Errore durante la rimozione dell'indirizzo.", "error");
                            }
                          }}
                          className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-2 rounded-xl transition cursor-pointer shrink-0"
                          title="Rimuovi questo indirizzo"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* Editor & Simulatore E-mail di Sistema */}
            <section className="bg-gradient-to-br from-indigo-50/80 to-slate-100 p-6 sm:p-8 rounded-3xl border border-indigo-200 shadow-sm space-y-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-indigo-200/60 pb-4">
                <div>
                  <h3 className="text-xl font-bold text-indigo-950 flex items-center gap-2">
                    <Mail className="w-6 h-6 text-indigo-600" /> Editor & Simulatore E-mail di Sistema
                  </h3>
                  <p className="text-xs text-indigo-700/80 mt-1">
                    Seleziona un evento automatizzato per personalizzare l'oggetto ed il testo principale delle mail inviate dal sistema.
                  </p>
                </div>

                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsMailPreviewModalOpen(true)}
                    className="bg-white hover:bg-indigo-50 text-indigo-700 font-bold px-3.5 py-2 rounded-xl border border-indigo-300 transition flex items-center gap-1.5 text-xs shadow-sm active:scale-95 cursor-pointer"
                  >
                    <Eye className="w-4 h-4" /> Anteprima HTML Live
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const recipient = userEmail || 'ebartalucci@ingegno06.it';
                      setSendingTestMail(true);
                      try {
                        const sampleVars: Record<string, string> = {};
                        currentTmplDef.placeholders.forEach(p => { sampleVars[p.code] = p.sample; });
                        const subj = substitutePlaceholders(editSubject, sampleVars);
                        const body = substitutePlaceholders(editBody, sampleVars);
                        await queueMail(recipient, subj, body);
                        showToast(`E-mail di prova inviata a ${recipient}!`, "success");
                      } catch (err) {
                        console.error(err);
                        showToast("Errore durante l'invio dell'e-mail di prova.", "error");
                      } finally {
                        setSendingTestMail(false);
                      }
                    }}
                    disabled={sendingTestMail}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-xl shadow-sm transition flex items-center gap-1.5 text-xs active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="w-4 h-4" /> {sendingTestMail ? 'Invio...' : 'Invia Mail di Prova'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 space-y-4">
                  <div>
                    <label className="block text-xs font-extrabold text-indigo-900 uppercase tracking-wide mb-1.5">Tipologia / Evento E-mail</label>
                    <select
                      value={selectedTemplateId}
                      onChange={e => setSelectedTemplateId(e.target.value)}
                      className="w-full p-3 bg-white border border-indigo-200 rounded-xl font-bold text-xs text-indigo-950 focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                    >
                      {Array.from(new Set(EMAIL_TEMPLATES_LIST.map(t => t.category))).map(cat => (
                        <optgroup key={cat} label={`── ${cat} ──`}>
                          {EMAIL_TEMPLATES_LIST.filter(t => t.category === cat).map(t => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  {/* Segnaposto disponibili */}
                  <div className="bg-white/80 p-4 rounded-2xl border border-indigo-150 shadow-inner space-y-2">
                    <label className="block text-[11px] font-black text-indigo-900 uppercase tracking-wider flex items-center gap-1">
                      <Code className="w-3.5 h-3.5 text-indigo-600" /> Segnaposto Dinamici (Placeholders)
                    </label>
                    <p className="text-[10px] text-gray-500">Clicca un tag per aggiungerlo al corpo della mail:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {currentTmplDef.placeholders.map(p => (
                        <button
                          key={p.code}
                          type="button"
                          onClick={() => setEditBody(prev => prev + ' ' + p.code)}
                          className="bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-[10px] font-bold px-2.5 py-1 rounded-lg transition cursor-pointer"
                          title={`Valore d'esempio: ${p.sample}`}
                        >
                          {p.code}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Pulsanti Azione Template */}
                  <div className="flex flex-col gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleSaveCustomTemplate}
                      disabled={savingTemplate}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-2.5 rounded-xl shadow transition text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {savingTemplate ? 'Salvataggio...' : '💾 Salva Modifiche Template'}
                    </button>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleResetTemplate}
                        className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-2 rounded-xl transition text-xs cursor-pointer flex items-center justify-center gap-1"
                        title="Ripristina layout predefinito per questo modello"
                      >
                        <span>↺ Ripristina</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const freshTmpl = EMAIL_TEMPLATES_LIST.find(t => t.id === selectedTemplateId);
                          if (freshTmpl) {
                            setEditSubject(freshTmpl.defaultSubject);
                            setEditBody(freshTmpl.defaultBody);
                            const updated = { ...customTemplates, [selectedTemplateId]: { subject: freshTmpl.defaultSubject, body: freshTmpl.defaultBody } };
                            setCustomTemplates(updated);
                            await saveEmailTemplates(updated);
                            showToast(`Nuova Grafica Premium applicata al modello "${freshTmpl.label}"!`, "success");
                          }
                        }}
                        className="flex-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-extrabold py-2 rounded-xl transition text-xs cursor-pointer flex items-center justify-center gap-1 border border-indigo-300"
                        title="Carica la nuova veste grafica ultra-premium per questo modello"
                      >
                        <span>✨ Carica Nuova Grafica</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Form di Editing Subject & Body */}
                <div className="lg:col-span-2 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">Oggetto dell'E-mail</label>
                    <input
                      type="text"
                      value={editSubject}
                      onChange={e => setEditSubject(e.target.value)}
                      className="w-full p-3 bg-white border border-gray-200 rounded-xl font-bold text-xs text-gray-900 focus:ring-2 focus:ring-indigo-400 outline-none shadow-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">Contenuto HTML del Messaggio (Corpo E-mail)</label>
                    <textarea
                      rows={9}
                      value={editBody}
                      onChange={e => setEditBody(e.target.value)}
                      className="w-full p-3.5 bg-white border border-gray-200 rounded-xl font-mono text-xs text-gray-800 focus:ring-2 focus:ring-indigo-400 outline-none shadow-inner leading-relaxed"
                    />
                  </div>
                </div>
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



      {/* Modale di Anteprima Grafica HTML Live per Template E-mail (Con Portal su document.body per centraggio assoluto) */}
      {isMailPreviewModalOpen && createPortal(
        <div className="fixed inset-0 bg-gray-900/70 backdrop-blur-md z-[999999] flex items-center justify-center p-4 sm:p-6 overflow-hidden">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-4xl w-full h-[85vh] border border-gray-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 bg-indigo-900 text-white flex justify-between items-center shrink-0">
              <h3 className="font-extrabold text-base flex items-center gap-2">
                <Eye className="w-5 h-5 text-indigo-300" /> Anteprima Grafica HTML Live: {currentTmplDef.label}
              </h3>
              <button
                type="button"
                onClick={() => setIsMailPreviewModalOpen(false)}
                className="hover:bg-white/20 p-1.5 rounded-xl transition text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-gray-100 flex-1 flex flex-col overflow-hidden min-h-0">
              {(() => {
                const sampleVars: Record<string, string> = {};
                currentTmplDef.placeholders.forEach(p => { sampleVars[p.code] = p.sample; });

                const isLegacyBody = !editBody.includes('background: linear-gradient');
                const bodyToRender = isLegacyBody ? currentTmplDef.defaultBody : editBody;
                const subjToRender = isLegacyBody ? currentTmplDef.defaultSubject : editSubject;

                const renderedSubj = substitutePlaceholders(subjToRender, sampleVars);
                const renderedBody = substitutePlaceholders(bodyToRender, sampleVars);
                const fullWrappedHtml = wrapMailTemplate(renderedSubj, renderedBody);

                return (
                  <div className="w-full flex-1 flex flex-col gap-2 min-h-0">
                    {isLegacyBody && (
                      <div className="bg-amber-100 border border-amber-300 text-amber-900 p-2.5 rounded-xl text-xs flex justify-between items-center font-bold shrink-0">
                        <span>⚠️ È caricata una versione precedente salvata in precedenza. Clicca per caricare la nuova grafica:</span>
                        <button
                          type="button"
                          onClick={async () => {
                            setEditSubject(currentTmplDef.defaultSubject);
                            setEditBody(currentTmplDef.defaultBody);
                             const updated = { ...customTemplates, [selectedTemplateId]: { subject: currentTmplDef.defaultSubject, body: currentTmplDef.defaultBody } };
                            setCustomTemplates(updated);
                            await saveEmailTemplates(updated);
                            showToast(`Nuova Grafica Premium applicata al modello!`, "success");
                          }}
                          className="px-3 py-1 bg-amber-700 text-white rounded-lg text-[11px] font-black hover:bg-amber-800 transition cursor-pointer shrink-0 ml-2"
                        >
                          ✨ Carica Nuova Grafica Premium
                        </button>
                      </div>
                    )}
                    <iframe
                      title="Full Mail Preview"
                      srcDoc={fullWrappedHtml}
                      className="w-full h-full border-0 bg-white rounded-xl shadow-sm"
                    />
                  </div>
                );
              })()}
            </div>
            <div className="p-4 bg-white border-t flex justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setIsMailPreviewModalOpen(false)}
                className="px-5 py-2.5 rounded-xl border text-xs font-bold text-gray-600 hover:bg-gray-50 transition cursor-pointer"
              >
                Chiudi
              </button>
              <button
                type="button"
                onClick={async () => {
                  setIsMailPreviewModalOpen(false);
                  const recipient = userEmail || 'ebartalucci@ingegno06.it';
                  setSendingTestMail(true);
                  try {
                    const sampleVars: Record<string, string> = {};
                    currentTmplDef.placeholders.forEach(p => { sampleVars[p.code] = p.sample; });
                    const isLegacyBody = !editBody.includes('background: linear-gradient');
                    const bodyToUse = isLegacyBody ? currentTmplDef.defaultBody : editBody;
                    const subjToUse = isLegacyBody ? currentTmplDef.defaultSubject : editSubject;
                    const subj = substitutePlaceholders(subjToUse, sampleVars);
                    const body = substitutePlaceholders(bodyToUse, sampleVars);
                    await queueMail(recipient, subj, body);
                    showToast(`E-mail di prova inviata a ${recipient}!`, "success");
                  } catch (err) {
                    console.error(err);
                    showToast("Errore durante l'invio dell'e-mail di prova.", "error");
                  } finally {
                    setSendingTestMail(false);
                  }
                }}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition flex items-center gap-2 shadow cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" /> Invia Mail di Prova
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}


      {/* MODALE MODIFICA CLIENTE */}
      {editingClient && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-6 sm:p-8 max-w-md w-full animate-in fade-in zoom-in-95 duration-200 flex flex-col gap-5">
            <div className="flex justify-between items-center pb-3 border-b border-gray-100">
              <h3 className="font-extrabold text-lg text-gray-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600" />
                <span>Modifica Ragione Sociale</span>
              </h3>
              <button 
                onClick={() => setEditingClient(null)} 
                className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveClientEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Codice Cliente (Progressivo Invariabile)</label>
                <input
                  type="text"
                  disabled
                  value={editingClient.codice}
                  className="w-full p-3 border-none rounded-xl bg-gray-100 text-gray-500 font-extrabold text-sm text-center cursor-not-allowed"
                />
                <p className="text-[10px] text-gray-400 italic mt-1 ml-1">
                  Il codice cliente progressivo è permanente per garantire la coerenza dello storico commesse.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 ml-1">Ragione Sociale *</label>
                <input
                  type="text"
                  required
                  value={editClientNome}
                  onChange={e => setEditClientNome(e.target.value)}
                  className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-800 text-sm shadow-inner"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingClient(null)}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 transition cursor-pointer"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold transition shadow-md cursor-pointer"
                >
                  Salva Modifiche
                </button>
              </div>
            </form>
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
