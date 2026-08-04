import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, isTechnicalUser } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, doc, setDoc, deleteDoc, getDocs, updateDoc } from 'firebase/firestore';
import { Shield, UserCheck, Star, Users, Plus, Trash2, Settings, Printer, Building2, Search, Pencil, X, Mail, Eye, Send, Code, Save, Briefcase, UserX, Crown } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { wrapMailTemplate } from '../utils/mailTemplate';
import { queueMail } from '../utils/mailSender';
import { getPrintDateString, APP_VERSION } from '../config/version';
import { 
  EMAIL_TEMPLATES_LIST, 
  loadSavedEmailTemplates, 
  saveEmailTemplates, 
  substitutePlaceholders,
  getCommesseNotificationEmails,
  saveCommesseNotificationEmails
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
  }, []);

  const [commesseNotifyEmails, setCommesseNotifyEmails] = useState<string[]>(['synergieflow@ingegno06.it']);
  const [newCommessaNotifyEmailInput, setNewCommessaNotifyEmailInput] = useState('');
  const [savingCommesseEmails, setSavingCommesseEmails] = useState(false);

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
  
  // Collaborator editing states (unused ones removed)
  
  const [newDipNome, setNewDipNome] = useState('');
  const [newDipEmail, setNewDipEmail] = useState('');
  const [newDipMacroArea, setNewDipMacroArea] = useState('');
  const [newDipDataNascita, setNewDipDataNascita] = useState('');
  const [newCollabNome, setNewCollabNome] = useState('');
  const [newCollabEmail, setNewCollabEmail] = useState('');
  const [newCollabMacroArea, setNewCollabMacroArea] = useState('');
  const [newCollabDataNascita, setNewCollabDataNascita] = useState('');
  const [searchDipendentiQuery, setSearchDipendentiQuery] = useState('');
  const [searchCollabQuery, setSearchCollabQuery] = useState('');

  // Edit Employee Modal States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingDip, setEditingDip] = useState<any>(null);
  const [editNome, setEditNome] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editTipo, setEditTipo] = useState<'dipendente' | 'collaboratore'>('dipendente');
  const [editMacroArea, setEditMacroArea] = useState('');
  const [editDataCessazione, setEditDataCessazione] = useState('');
  const [editDataNascita, setEditDataNascita] = useState('');
  const [editDailyRate, setEditDailyRate] = useState('');
  const [editInpsRate, setEditInpsRate] = useState('');
  const [editIvaRate, setEditIvaRate] = useState('');
  const [editRaRate, setEditRaRate] = useState('');
  const [editImportoFisso, setEditImportoFisso] = useState('');
  const [editOrarioSettimanale, setEditOrarioSettimanale] = useState<Record<string, number | ''>>({ lun: 8, mar: 8, mer: 8, gio: 8, ven: 8 });
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
      await addDoc(collection(db, 'admins'), { email: newAdminEmail.toLowerCase() });
      await refreshData();
      await loadImpostazioniLists();
    }
    setNewAdminEmail('');
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



  const handleAddDipendente = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newDipNome) {
      await addDoc(collection(db, 'dipendenti'), { 
        nome: newDipNome, 
        email: newDipEmail.toLowerCase(),
        tipo: 'dipendente',
        macroArea: newDipMacroArea || null,
        dataNascita: newDipDataNascita || null
      });
      await refreshData();
      setNewDipNome('');
      setNewDipEmail('');
      setNewDipMacroArea('');
      setNewDipDataNascita('');
    }
  };

  const handleAddCollaboratore = async (e: React.FormEvent) => {
    e.preventDefault();
    if(newCollabNome) {
      await addDoc(collection(db, 'dipendenti'), { 
        nome: newCollabNome, 
        email: newCollabEmail.toLowerCase(),
        tipo: 'collaboratore',
        macroArea: newCollabMacroArea || null,
        dataNascita: newCollabDataNascita || null
      });
      await refreshData();
      setNewCollabNome('');
      setNewCollabEmail('');
      setNewCollabMacroArea('');
      setNewCollabDataNascita('');
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

  const handleOpenEditModal = (dip: any) => {
    setEditingDip(dip);
    setEditNome(dip.nome);
    setEditEmail(dip.email || '');
    setEditTipo(isCollaboratore(dip.nome, dip.tipo) ? 'collaboratore' : 'dipendente');
    setEditMacroArea(dip.macroArea || '');
    setEditDataCessazione(dip.dataCessazione || '');
    setEditDataNascita(dip.dataNascita || '');
    setEditDailyRate(dip.dailyRate !== undefined && dip.dailyRate !== null ? dip.dailyRate.toString() : '');
    setEditInpsRate(dip.inpsRate !== undefined && dip.inpsRate !== null ? dip.inpsRate.toString() : '');
    setEditIvaRate(dip.ivaRate !== undefined && dip.ivaRate !== null ? dip.ivaRate.toString() : '');
    setEditRaRate(dip.raRate !== undefined && dip.raRate !== null ? dip.raRate.toString() : '');
    setEditImportoFisso(dip.importoFissoMensile !== undefined && dip.importoFissoMensile !== null ? dip.importoFissoMensile.toString() : '');
    setEditOrarioSettimanale(dip.orarioSettimanale || {
      lun: dip.oreContratto ?? 8,
      mar: dip.oreContratto ?? 8,
      mer: dip.oreContratto ?? 8,
      gio: dip.oreContratto ?? 8,
      ven: dip.oreContratto ?? 8
    });
    setIsEditModalOpen(true);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDip) return;

    if (isSoci(editingDip.nome) && editTipo !== 'dipendente') {
      showToast("Non è possibile modificare la tipologia di un socio proprietario.", "warning");
      return;
    }

    try {
      const docRef = doc(db, 'dipendenti', editingDip.id);
      const cleanOrario = {
        lun: editOrarioSettimanale.lun === '' ? 0 : editOrarioSettimanale.lun,
        mar: editOrarioSettimanale.mar === '' ? 0 : editOrarioSettimanale.mar,
        mer: editOrarioSettimanale.mer === '' ? 0 : editOrarioSettimanale.mer,
        gio: editOrarioSettimanale.gio === '' ? 0 : editOrarioSettimanale.gio,
        ven: editOrarioSettimanale.ven === '' ? 0 : editOrarioSettimanale.ven,
      };
      const totalWeekly = Object.values(cleanOrario).reduce((a, b) => a + b, 0);
      const avgDaily = totalWeekly / 5;

      const payload: any = {
        nome: editNome.trim(),
        email: editEmail.trim().toLowerCase(),
        tipo: editTipo,
        macroArea: editMacroArea || null,
        dataCessazione: editDataCessazione || null,
        dataNascita: editDataNascita || null,
        orarioSettimanale: editTipo === 'collaboratore' ? null : cleanOrario,
        oreContratto: editTipo === 'collaboratore' ? null : avgDaily,
      };

      if (editTipo === 'collaboratore') {
        payload.dailyRate = editDailyRate ? Number(editDailyRate) : null;
        payload.inpsRate = editInpsRate ? Number(editInpsRate) : null;
        payload.ivaRate = editIvaRate ? Number(editIvaRate) : null;
        payload.raRate = editRaRate ? Number(editRaRate) : null;
        payload.importoFissoMensile = editImportoFisso ? Number(editImportoFisso) : null;
      } else {
        payload.dailyRate = null;
        payload.inpsRate = null;
        payload.ivaRate = null;
        payload.raRate = null;
        payload.importoFissoMensile = null;
      }

      await updateDoc(docRef, payload);
      await refreshData();
      showToast("Risorsa aggiornata con successo!", "success");
      setIsEditModalOpen(false);
      setEditingDip(null);
    } catch (err) {
      console.error("Errore aggiornamento risorsa:", err);
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



  const handleRemoveDipendente = (id: string) => {
    const target = dipendenti.find(d => d.id === id);
    if (target && isSoci(target.nome)) {
      showToast("Non è possibile rimuovere un socio proprietario.", "warning");
      return;
    }

    triggerConfirm(
      "Rimuovi Risorsa",
      `Sei sicuro di voler eliminare definitivamente ${target ? target.nome : 'questa risorsa'}? Questa azione non può essere annullata.`,
      async () => {
        try {
          await deleteDoc(doc(db, 'dipendenti', id));
          await refreshData();
          setIsEditModalOpen(false);
          setEditingDip(null);
          showToast("Risorsa rimossa con successo.", "success");
        } catch (err) {
          console.error("Errore nella rimozione della risorsa:", err);
          showToast("Errore durante l'eliminazione.", "error");
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

  const handlePrintCollaboratori = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const listCollab = dipendenti.filter(d => isCollaboratore(d.nome, d.tipo) && !isSoci(d.nome));
    
    const rowsHtml = listCollab.length === 0 ? `
      <tr>
        <td colspan="4" style="text-align: center; padding: 20px; color: #9ca3af; font-weight: 700;">
          Nessun collaboratore esterno censito.
        </td>
      </tr>
    ` : listCollab.map((c, idx) => {
      const rowBg = idx % 2 === 1 ? 'background-color: #f9fafb;' : 'background-color: #ffffff;';
      const area = c.macroArea || 'Collaboratore';
      return `
        <tr style="${rowBg}">
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; text-align: center; font-weight: 800;">${idx + 1}</td>
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; font-weight: 800; color: #111827;">${c.nome}</td>
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; font-weight: 600; color: #374151;">${area}</td>
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; font-weight: 500; color: #4b5563;">${c.email || '—'}</td>
        </tr>
      `;
    }).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="it">
      <head>
        <meta charset="UTF-8">
        <title>Anagrafica Collaboratori Esterni</title>
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
                  <div class="header-title-right">INGEGNO P&C S.R.L. · ANAGRAFICA COLLABORATORI</div>
                </div>
                <div class="title-banner">
                  <span class="title-banner-text">ANAGRAFICA COLLABORATORI ESTERNI</span>
                  <span class="count-badge">${listCollab.length} COLLAB.</span>
                </div>
              </td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div class="filter-box">
                  <span><strong>Data Stampa:</strong> ${getPrintDateString()}</span>
                  <span><strong>Totale Collaboratori Censiti:</strong> ${listCollab.length}</span>
                </div>

                <table class="report-table">
                  <thead>
                    <tr>
                      <th style="width: 8%; text-align: center;">#</th>
                      <th style="width: 35%; text-align: left;">Nome Completo</th>
                      <th style="width: 25%; text-align: left;">Macro Area / Ruolo</th>
                      <th style="width: 32%; text-align: left;">Email Contatto</th>
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

  const handlePrintDipendenti = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const listDip = dipendenti.filter(d => !isCollaboratore(d.nome, d.tipo) && !isSoci(d.nome));
    
    const rowsHtml = listDip.length === 0 ? `
      <tr>
        <td colspan="4" style="text-align: center; padding: 20px; color: #9ca3af; font-weight: 700;">
          Nessun dipendente censito.
        </td>
      </tr>
    ` : listDip.map((d, idx) => {
      const rowBg = idx % 2 === 1 ? 'background-color: #f9fafb;' : 'background-color: #ffffff;';
      const area = d.macroArea || 'Dipendente';
      return `
        <tr style="${rowBg}">
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; text-align: center; font-weight: 800;">${idx + 1}</td>
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; font-weight: 800; color: #111827;">${d.nome}</td>
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; font-weight: 600; color: #374151;">${area}</td>
          <td style="padding: 4px 6px; border: 1px solid #d1d5db; font-weight: 500; color: #4b5563;">${d.email || '—'}</td>
        </tr>
      `;
    }).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="it">
      <head>
        <meta charset="UTF-8">
        <title>Anagrafica Dipendenti Team</title>
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
                  <div class="header-title-right">INGEGNO P&C S.R.L. · ANAGRAFICA DIPENDENTI</div>
                </div>
                <div class="title-banner">
                  <span class="title-banner-text">ANAGRAFICA DIPENDENTI TEAM</span>
                  <span class="count-badge">${listDip.length} DIPENDENTE/I</span>
                </div>
              </td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div class="filter-box">
                  <span><strong>Data Stampa:</strong> ${getPrintDateString()}</span>
                  <span><strong>Totale Dipendenti Censiti:</strong> ${listDip.length}</span>
                </div>

                <table class="report-table">
                  <thead>
                    <tr>
                      <th style="width: 8%; text-align: center;">#</th>
                      <th style="width: 35%; text-align: left;">Nome Completo</th>
                      <th style="width: 25%; text-align: left;">Macro Area / Ruolo</th>
                      <th style="width: 32%; text-align: left;">Email Aziendale</th>
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
          <div className="flex flex-col gap-6">
            
            {/* 1. PANNELLO IN ALTO A TUTTA LARGHEZZA: SOCI PROPRIETARI & DIREZIONE AZIENDALE */}
            <section className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-white rounded-3xl p-6 shadow-md border border-amber-400/30">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-white/20 backdrop-blur-md rounded-2xl text-white shadow-xs">
                    <Crown className="w-6 h-6 fill-amber-200 text-amber-100" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black tracking-wider uppercase flex items-center gap-2">
                      Soci Proprietari & Direzione Aziendale
                    </h3>
                    <p className="text-xs text-amber-100 font-medium">Soci di riferimento e direzione generale (modifica email e data di nascita)</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {dipendenti
                  .filter(d => isSoci(d.nome))
                  .map(socio => (
                    <div 
                      key={socio.id} 
                      className="bg-white/95 text-amber-950 p-4 rounded-2xl border border-white/80 shadow-xs flex justify-between items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-extrabold text-sm text-gray-900 truncate">{socio.nome}</div>
                        <div className="text-xs text-amber-800 font-medium truncate">{socio.email || 'Nessuna email'}</div>
                        {socio.dataNascita && (
                          <div className="text-[10.5px] font-bold text-gray-500 mt-1 flex items-center gap-1">
                            🎂 Nascita: {socio.dataNascita.split('-').reverse().join('/')}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] bg-amber-100 text-amber-900 px-2.5 py-1 rounded-lg font-black uppercase tracking-wider">
                          Socio
                        </span>
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(socio)}
                          className="p-2 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-xl transition cursor-pointer"
                          title="Modifica profilo socio"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                ))}
              </div>
            </section>

            {/* 2. GRIGLIA A 2 COLONNE SOTTO: DIPENDENTI E COLLABORATORI */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* Anagrafica Dipendenti */}
              <section className="bg-gradient-to-br from-indigo-50 to-slate-50 p-6 rounded-3xl border border-indigo-100 shadow-sm flex flex-col">
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
                
                {/* Form aggiunta dipendente */}
                <form onSubmit={handleAddDipendente} className="flex flex-col gap-3 mb-5">
                  <input required type="text" placeholder="Cognome e Nome" value={newDipNome} onChange={e => setNewDipNome(e.target.value)} className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition shadow-inner font-bold text-gray-700 text-xs" />
                  <input required type="email" placeholder="Email Aziendale" value={newDipEmail} onChange={e => setNewDipEmail(e.target.value)} className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition shadow-inner font-bold text-gray-700 text-xs" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-900/70 mb-1 ml-1">Macro Area</label>
                      <select 
                        value={newDipMacroArea} 
                        onChange={e => setNewDipMacroArea(e.target.value)} 
                        className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition shadow-inner font-bold text-gray-700 text-xs"
                      >
                        <option value="">-- Seleziona Macro Area --</option>
                        <option value="Disegnatori">Disegnatori</option>
                        <option value="Ingegneria">Ingegneria</option>
                        <option value="Sicurezza Cantieri">Sicurezza Cantieri</option>
                        <option value="Consulenza Sicurezza">Consulenza Sicurezza</option>
                        <option value="Amministrazione">Amministrazione</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-900/70 mb-1 ml-1">Data di Nascita</label>
                      <div className="flex gap-2">
                        <input 
                          type="date" 
                          title="Data di Nascita" 
                          value={newDipDataNascita} 
                          onChange={e => setNewDipDataNascita(e.target.value)} 
                          className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition shadow-inner font-bold text-gray-700 text-xs cursor-pointer" 
                        />
                        <button type="submit" className="bg-indigo-600 text-white px-4 rounded-xl hover:bg-indigo-700 transition font-bold shadow-md active:scale-95 flex items-center gap-1 shrink-0 cursor-pointer"><Plus className="w-4 h-4"/> Aggiungi</button>
                      </div>
                    </div>
                  </div>
                </form>

                {/* Ricerca Dipendenti */}
                <div className="bg-white/80 border border-indigo-100 rounded-xl p-2.5 mb-3 flex items-center gap-2 shadow-xs">
                  <Search className="w-4 h-4 text-indigo-500 shrink-0" />
                  <input
                    type="text"
                    placeholder="Cerca dipendente per Nome, Cognome o Email..."
                    value={searchDipendentiQuery}
                    onChange={e => setSearchDipendentiQuery(e.target.value)}
                    className="w-full bg-transparent outline-none font-bold text-gray-700 text-xs placeholder:text-gray-400 placeholder:font-normal"
                  />
                  {searchDipendentiQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchDipendentiQuery('')}
                      className="text-[10px] font-bold text-gray-400 hover:text-gray-600 px-2 py-0.5 bg-gray-100 rounded-lg cursor-pointer transition shrink-0"
                    >
                      Azzera
                    </button>
                  )}
                </div>

                <div className="max-h-[480px] overflow-y-auto bg-white/50 rounded-xl divide-y border border-indigo-100 flex-1">
                  {dipendenti.filter(d => !isCollaboratore(d.nome, d.tipo) && !isSoci(d.nome) && !isTechnicalUser(d) && (!d.dataCessazione || d.dataCessazione >= new Date().toLocaleDateString('sv-SE')) && (!searchDipendentiQuery.trim() || d.nome.toLowerCase().includes(searchDipendentiQuery.toLowerCase().trim()) || (d.email || '').toLowerCase().includes(searchDipendentiQuery.toLowerCase().trim()))).map(d => (
                    <div key={d.id} className="p-4 flex justify-between items-center text-sm gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-indigo-900 truncate">{d.nome}</div>
                        <div className="text-xs text-indigo-600/70 truncate">{d.email || 'Nessuna email'}</div>
                        {d.dataNascita && (
                          <div className="text-[10.5px] font-bold text-gray-500 mt-0.5">
                            🎂 Nascita: {d.dataNascita.split('-').reverse().join('/')}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button 
                          type="button"
                          onClick={() => handleOpenEditModal(d)} 
                          className="p-2 text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors cursor-pointer"
                          title="Modifica risorsa"
                        >
                          <Pencil className="w-4 h-4"/>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Archivio Dipendenti Cessati */}
                {(() => {
                  const cessati = dipendenti.filter(d => !isCollaboratore(d.nome, d.tipo) && !isSoci(d.nome) && !isTechnicalUser(d) && d.dataCessazione && d.dataCessazione < new Date().toLocaleDateString('sv-SE') && (!searchDipendentiQuery.trim() || d.nome.toLowerCase().includes(searchDipendentiQuery.toLowerCase().trim()) || (d.email || '').toLowerCase().includes(searchDipendentiQuery.toLowerCase().trim())));
                  if (cessati.length === 0) return null;
                  return (
                    <div className="mt-5 pt-4 border-t border-indigo-200/80">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                          <UserX className="w-4 h-4 text-slate-500" />
                          Archivio Dipendenti Cessati ({cessati.length})
                        </h4>
                      </div>
                      <div className="max-h-[220px] overflow-y-auto bg-slate-100/70 rounded-xl divide-y divide-slate-200 border border-slate-200">
                        {cessati.map(d => (
                          <div key={d.id} className="p-3 flex justify-between items-center text-xs gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-slate-700 truncate">{d.nome}</div>
                              <div className="text-[10px] text-slate-500 truncate">{d.email || 'Nessuna email'}</div>
                              <div className="text-[10px] font-bold text-rose-700 mt-0.5">
                                Cessato il: {d.dataCessazione ? d.dataCessazione.split('-').reverse().join('/') : ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button 
                                type="button"
                                onClick={() => handleOpenEditModal(d)} 
                                className="px-2 py-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-200 cursor-pointer flex items-center gap-1"
                                title="Modifica o reintegra dipendente"
                              >
                                <Pencil className="w-3 h-3"/> Modifica / Reintegra
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </section>

              {/* Anagrafica Collaboratori P. IVA */}
              <section className="bg-gradient-to-br from-amber-50 to-stone-50 p-6 rounded-3xl border border-amber-100 shadow-sm flex flex-col">
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
                
                {/* Form aggiunta collaboratore */}
                <form onSubmit={handleAddCollaboratore} className="flex flex-col gap-3 mb-5">
                  <input required type="text" placeholder="Cognome e Nome" value={newCollabNome} onChange={e => setNewCollabNome(e.target.value)} className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-amber-400 transition shadow-inner font-bold text-gray-700 text-xs" />
                  <input required type="email" placeholder="Email Aziendale" value={newCollabEmail} onChange={e => setNewCollabEmail(e.target.value)} className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-amber-400 transition shadow-inner font-bold text-gray-700 text-xs" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
                    <div>
                      <label className="block text-[10px] font-bold text-amber-900/70 mb-1 ml-1">Macro Area</label>
                      <select 
                        value={newCollabMacroArea} 
                        onChange={e => setNewCollabMacroArea(e.target.value)} 
                        className="w-full p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-amber-400 transition shadow-inner font-bold text-gray-700 text-xs"
                      >
                        <option value="">-- Seleziona Macro Area --</option>
                        <option value="Disegnatori">Disegnatori</option>
                        <option value="Ingegneria">Ingegneria</option>
                        <option value="Sicurezza Cantieri">Sicurezza Cantieri</option>
                        <option value="Consulenza Sicurezza">Consulenza Sicurezza</option>
                        <option value="Amministrazione">Amministrazione</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-amber-900/70 mb-1 ml-1">Data di Nascita</label>
                      <div className="flex gap-2">
                        <input 
                          type="date" 
                          title="Data di Nascita" 
                          value={newCollabDataNascita} 
                          onChange={e => setNewCollabDataNascita(e.target.value)} 
                          className="flex-1 p-3 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-amber-400 transition shadow-inner font-bold text-gray-700 text-xs cursor-pointer" 
                        />
                        <button type="submit" className="bg-amber-600 text-white px-4 rounded-xl hover:bg-amber-700 transition font-bold shadow-md active:scale-95 flex items-center gap-1 shrink-0 cursor-pointer"><Plus className="w-4 h-4"/> Aggiungi</button>
                      </div>
                    </div>
                  </div>
                </form>

                {/* Ricerca Collaboratori */}
                <div className="bg-white/80 border border-amber-100 rounded-xl p-2.5 mb-3 flex items-center gap-2 shadow-xs">
                  <Search className="w-4 h-4 text-amber-500 shrink-0" />
                  <input
                    type="text"
                    placeholder="Cerca collaboratore per Nome, Cognome o Email..."
                    value={searchCollabQuery}
                    onChange={e => setSearchCollabQuery(e.target.value)}
                    className="w-full bg-transparent outline-none font-bold text-gray-700 text-xs placeholder:text-gray-400 placeholder:font-normal"
                  />
                  {searchCollabQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchCollabQuery('')}
                      className="text-[10px] font-bold text-gray-400 hover:text-gray-600 px-2 py-0.5 bg-gray-100 rounded-lg cursor-pointer transition shrink-0"
                    >
                      Azzera
                    </button>
                  )}
                </div>

                <div className="max-h-[480px] overflow-y-auto bg-white/50 rounded-xl divide-y border border-amber-100 flex-1">
                  {dipendenti.filter(d => isCollaboratore(d.nome, d.tipo) && !isSoci(d.nome) && !isTechnicalUser(d) && (!d.dataCessazione || d.dataCessazione >= new Date().toLocaleDateString('sv-SE')) && (!searchCollabQuery.trim() || d.nome.toLowerCase().includes(searchCollabQuery.toLowerCase().trim()) || (d.email || '').toLowerCase().includes(searchCollabQuery.toLowerCase().trim()))).map(d => (
                    <div key={d.id} className="p-4 flex justify-between items-center text-sm gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-amber-900 truncate">{d.nome}</div>
                        <div className="text-xs text-amber-600/70 truncate">{d.email || 'Nessuna email'}</div>
                        {d.dataNascita && (
                          <div className="text-[10.5px] font-bold text-gray-500 mt-0.5">
                            🎂 Nascita: {d.dataNascita.split('-').reverse().join('/')}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button 
                          type="button"
                          onClick={() => handleOpenEditModal(d)} 
                          className="p-2 text-amber-600 hover:text-amber-850 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors cursor-pointer"
                          title="Modifica risorsa"
                        >
                          <Pencil className="w-4 h-4"/>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Archivio Collaboratori Cessati */}
                {(() => {
                  const cessatiCollab = dipendenti.filter(d => isCollaboratore(d.nome, d.tipo) && !isSoci(d.nome) && !isTechnicalUser(d) && d.dataCessazione && d.dataCessazione < new Date().toLocaleDateString('sv-SE') && (!searchCollabQuery.trim() || d.nome.toLowerCase().includes(searchCollabQuery.toLowerCase().trim()) || (d.email || '').toLowerCase().includes(searchCollabQuery.toLowerCase().trim())));
                  if (cessatiCollab.length === 0) return null;
                  return (
                    <div className="mt-5 pt-4 border-t border-amber-200/80">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                          <UserX className="w-4 h-4 text-slate-500" />
                          Archivio Collaboratori Cessati ({cessatiCollab.length})
                        </h4>
                      </div>
                      <div className="max-h-[220px] overflow-y-auto bg-slate-100/70 rounded-xl divide-y divide-slate-200 border border-slate-200">
                        {cessatiCollab.map(d => (
                          <div key={d.id} className="p-3 flex justify-between items-center text-xs gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-slate-700 truncate">{d.nome}</div>
                              <div className="text-[10px] text-slate-500 truncate">{d.email || 'Nessuna email'}</div>
                              <div className="text-[10px] font-bold text-rose-700 mt-0.5">
                                Cessato il: {d.dataCessazione ? d.dataCessazione.split('-').reverse().join('/') : ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button 
                                type="button"
                                onClick={() => handleOpenEditModal(d)} 
                                className="px-2 py-1 text-[10px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors border border-amber-200 cursor-pointer flex items-center gap-1"
                                title="Modifica o reintegra collaboratore"
                              >
                                <Pencil className="w-3 h-3"/> Modifica / Reintegra
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </section>

            </div>

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
                      {sortedDipendentiWithEmail.map((d: any) => <option key={d.id} value={d.email}>{d.nome}</option>)}
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
                      {sortedDipendentiWithEmail.map((d: any) => <option key={d.id} value={d.email}>{d.nome}</option>)}
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
                      {sortedDipendentiWithEmail.map((d: any) => <option key={d.id} value={d.email}>{d.nome}</option>)}
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
                      {sortedDipendentiWithEmail.map((d: any) => <option key={d.id} value={d.email}>{d.nome}</option>)}
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
                  const areaMembers = dipendenti
                    .filter(d => d && d.macroArea === areaName && !isSoci(d.nome) && (d.email || '').toLowerCase().trim() !== 'synergieflow@ingegno06.it' && (d.email || '').toLowerCase().trim() !== 'synergiesflow@ingegno06.it' && !coordinatori.some(c => (c.email || '').toLowerCase() === (d.email || '').toLowerCase() && c.area === areaName))
                    .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'it'));
                  const areaCoordinators = coordinatori
                    .filter(c => c && c.area === areaName)
                    .sort((a, b) => (getDipNomeFromEmail(a.email) || '').localeCompare(getDipNomeFromEmail(b.email) || '', 'it'));
                  
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
                  Abilita o disabilita singolarmente le risorse a ricevere e-mail automatiche dal sistema (notifiche ferie, weekend, invio e approvazione foglio ore/fatture, assegnazione commesse, ecc.).
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
                  const filtered = dipendenti.filter(dip => 
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

            {/* Destinatari Notifiche Commesse (Apertura & Chiusura) */}
            <section className="bg-gradient-to-br from-emerald-50/80 to-teal-50 p-6 rounded-3xl border border-emerald-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-emerald-200/60 pb-3">
                <div>
                  <h3 className="text-xl font-bold text-emerald-950 flex items-center gap-2">
                    <Mail className="w-6 h-6 text-emerald-600" /> Destinatari Notifiche Commesse (Apertura & Chiusura)
                  </h3>
                  <p className="text-xs text-emerald-800/80 mt-1">
                    Aggiungi uno o più indirizzi e-mail a cui inviare le notifiche automatiche quando una commessa viene <strong>aperta</strong> o <strong>chiusa</strong>. Se una persona è in ferie, gli altri indirizzi in lista continueranno a ricevere regolarmente le comunicazioni.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setSavingCommesseEmails(true);
                    try {
                      await saveCommesseNotificationEmails(commesseNotifyEmails);
                      showToast("Elenco destinatari e-mail commesse salvato con successo!", "success");
                    } catch (err) {
                      console.error(err);
                      showToast("Errore durante il salvataggio degli indirizzi e-mail.", "error");
                    } finally {
                      setSavingCommesseEmails(false);
                    }
                  }}
                  disabled={savingCommesseEmails}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl shadow-sm transition text-xs flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-4 h-4" /> {savingCommesseEmails ? 'Salvataggio...' : 'Salva Destinatari'}
                </button>
              </div>

              {/* Form per inserire un nuovo indirizzo */}
              <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <input
                  type="email"
                  placeholder="Es. synergieflow@ingegno06.it"
                  value={newCommessaNotifyEmailInput}
                  onChange={e => setNewCommessaNotifyEmailInput(e.target.value)}
                  className="flex-1 px-4 py-2.5 bg-white border border-emerald-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm"
                />
                <button
                  type="button"
                  onClick={() => {
                    const cleaned = newCommessaNotifyEmailInput.toLowerCase().trim();
                    if (!cleaned) {
                      showToast("Inserisci un indirizzo e-mail valido.", "warning");
                      return;
                    }
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
                      showToast("Il formato dell'indirizzo e-mail non è valido.", "warning");
                      return;
                    }
                    if (commesseNotifyEmails.includes(cleaned)) {
                      showToast("Questo indirizzo e-mail è già presente nell'elenco.", "warning");
                      return;
                    }
                    setCommesseNotifyEmails(prev => [...prev, cleaned]);
                    setNewCommessaNotifyEmailInput('');
                  }}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-4 py-2.5 rounded-xl transition text-xs flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Aggiungi Indirizzo
                </button>
              </div>

              {/* Badge / Chips con gli indirizzi aggiunti */}
              <div className="flex flex-wrap gap-2 pt-1">
                {commesseNotifyEmails.length === 0 ? (
                  <span className="text-xs text-slate-400 italic font-medium">Nessun indirizzo impostato. Verrà usato di default synergieflow@ingegno06.it</span>
                ) : (
                  commesseNotifyEmails.map((email, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-2 bg-white border border-emerald-300 text-emerald-900 font-extrabold text-xs px-3 py-1.5 rounded-xl shadow-xs"
                    >
                      <Mail className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{email}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setCommesseNotifyEmails(prev => prev.filter((_, i) => i !== idx));
                        }}
                        className="text-slate-400 hover:text-rose-600 transition p-0.5 rounded cursor-pointer"
                        title="Rimuovi indirizzo"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))
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
                      {['Commesse', 'Ferie & Assenze', 'Presenze'].map(cat => (
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
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleSaveCustomTemplate}
                      disabled={savingTemplate}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-2.5 rounded-xl shadow transition text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {savingTemplate ? 'Salvataggio...' : '💾 Salva Modifiche'}
                    </button>
                    <button
                      type="button"
                      onClick={handleResetTemplate}
                      className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold px-3 py-2.5 rounded-xl transition text-xs cursor-pointer"
                      title="Ripristina testo predefinito"
                    >
                      Ripristina
                    </button>
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

      {/* Sleek Edit Employee Modal */}
      {isEditModalOpen && editingDip && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden border border-gray-100 flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-6 bg-gradient-to-r from-indigo-600 to-indigo-800 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-xl font-bold">Modifica Risorsa</h3>
                <p className="text-xs text-indigo-200/90 font-medium">Aggiorna le informazioni di {editingDip.nome}</p>
              </div>
              <button 
                type="button"
                onClick={() => { setIsEditModalOpen(false); setEditingDip(null); }}
                className="p-1.5 bg-white/10 hover:bg-white/20 rounded-xl transition text-white hover:text-gray-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body / Form */}
            <form onSubmit={handleSaveEmployee} className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Nome e Cognome */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">
                  Nome e Cognome {isSoci(editingDip.nome) && '(Socio Proprietario - Non Modificabile)'}
                </label>
                <input
                  required
                  disabled={isSoci(editingDip.nome)}
                  type="text"
                  value={editNome}
                  onChange={e => setEditNome(e.target.value)}
                  className={`w-full p-3 border rounded-xl outline-none font-bold text-xs ${
                    isSoci(editingDip.nome)
                      ? 'bg-gray-100/80 text-gray-500 border-dashed cursor-not-allowed'
                      : 'bg-gray-50 border-gray-200 focus:bg-white focus:ring-2 focus:ring-indigo-400 text-gray-700'
                  }`}
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Email Aziendale</label>
                <input
                  required
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition font-bold text-gray-705 text-xs"
                />
              </div>

              {/* Tipo di Risorsa */}
              {!isSoci(editingDip.nome) && (
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1.5 ml-1">Tipologia Risorsa</label>
                  <div className="grid grid-cols-2 gap-2 bg-gray-50 p-1 rounded-xl border border-gray-200">
                    <button
                      type="button"
                      onClick={() => setEditTipo('dipendente')}
                      className={`p-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        editTipo === 'dipendente'
                          ? 'bg-white text-indigo-700 shadow-sm border border-indigo-100'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Dipendente
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTipo('collaboratore')}
                      className={`p-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        editTipo === 'collaboratore'
                          ? 'bg-white text-amber-700 shadow-sm border border-amber-100'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Collaboratore P. IVA
                    </button>
                  </div>
                </div>
              )}

              {/* Macro Area */}
              {!isSoci(editingDip.nome) && (
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Macro Area</label>
                  <select
                    value={editMacroArea}
                    onChange={e => setEditMacroArea(e.target.value)}
                    className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition font-bold text-gray-705 text-xs"
                  >
                    <option value="">Nessuna Area</option>
                    <option value="Disegnatori">Disegnatori</option>
                    <option value="Ingegneria">Ingegneria</option>
                    <option value="Sicurezza Cantieri">Sicurezza Cantieri</option>
                    <option value="Consulenza Sicurezza">Consulenza Sicurezza</option>
                    <option value="Amministrazione">Amministrazione</option>
                  </select>
                </div>
              )}

              {/* Data di Nascita & Data Cessazione */}
              <div className={`grid gap-3 ${isSoci(editingDip.nome) ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Data di Nascita</label>
                  <input
                    type="date"
                    value={editDataNascita}
                    onChange={e => setEditDataNascita(e.target.value)}
                    className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition font-bold text-gray-705 text-xs cursor-pointer"
                  />
                </div>

                {!isSoci(editingDip.nome) && (
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Data Cessazione</label>
                    <input
                      type="date"
                      value={editDataCessazione}
                      onChange={e => setEditDataCessazione(e.target.value)}
                      className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition font-bold text-gray-705 text-xs cursor-pointer"
                    />
                  </div>
                )}
              </div>

              {/* Ore Contratto (Griglia Settimanale) */}
              {!isSoci(editingDip.nome) && editTipo !== 'collaboratore' && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-gray-500 ml-1">Orario di Contratto Settimanale (ore giornaliere)</label>
                  <div className="grid grid-cols-5 gap-2 bg-gray-50 p-3 rounded-2xl border border-gray-150">
                    {['lun', 'mar', 'mer', 'gio', 'ven'].map(day => (
                      <div key={day} className="flex flex-col items-center gap-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase">{day}</span>
                        <input 
                          type="number"
                          step="any"
                          min={0}
                          max={24}
                          value={editOrarioSettimanale[day as keyof typeof editOrarioSettimanale] ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? '' : Number(e.target.value);
                            setEditOrarioSettimanale(prev => ({ ...prev, [day]: val }));
                          }}
                          className="w-full p-2 border border-gray-250 rounded-xl bg-white text-center font-bold text-gray-805 text-xs outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-xl w-fit">
                    Totale settimanale: {Object.values(editOrarioSettimanale).reduce((a: number, b) => a + (b === '' ? 0 : (b as number)), 0)} ore
                  </div>
                </div>
              )}

              {/* Dati specifici Collaboratore */}
              {!isSoci(editingDip.nome) && editTipo === 'collaboratore' && (
                <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-100 space-y-4 animate-in slide-in-from-top duration-150">
                  <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-2">Dettagli Fiscali Collaboratore</h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1 ml-1">Tariffa Giornaliera (€/gg)</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={editDailyRate}
                        onChange={e => setEditDailyRate(e.target.value)}
                        className="w-full p-2.5 border border-gray-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-amber-400 transition font-semibold text-gray-700 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1 ml-1">Aliquota Cassa Previdenziale (%)</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={editInpsRate}
                        onChange={e => setEditInpsRate(e.target.value)}
                        className="w-full p-2.5 border border-gray-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-amber-400 transition font-semibold text-gray-700 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1 ml-1">Aliquota IVA (%)</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={editIvaRate}
                        onChange={e => setEditIvaRate(e.target.value)}
                        className="w-full p-2.5 border border-gray-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-amber-400 transition font-semibold text-gray-700 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1 ml-1">Ritenuta d'Acconto (%)</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={editRaRate}
                        onChange={e => setEditRaRate(e.target.value)}
                        className="w-full p-2.5 border border-gray-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-amber-400 transition font-semibold text-gray-700 text-xs"
                      />
                    </div>
                  </div>

                  <div className="pt-3 border-t border-amber-200/60">
                    <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-2">Accordo a Canone Fisso Mensile</div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1 ml-1">Importo Fisso Mensile (€, 0 = disabilitato)</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={editImportoFisso}
                        onChange={e => {
                          setEditImportoFisso(e.target.value);
                          if (e.target.value && Number(e.target.value) > 0) {
                            setEditDailyRate('0');
                          }
                        }}
                        className="w-full p-2.5 border border-gray-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-amber-400 transition font-semibold text-gray-700 text-xs"
                      />
                      <p className="text-[9px] text-gray-400 mt-1 ml-1">Se valorizzato, il compenso mensile per questo collaboratore sarà pre-compilato con questa cifra fissa invece di calcolare giornate × tariffa.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal Actions */}
              <div className="flex gap-3 pt-4 border-t border-gray-100">
                {!isSoci(editingDip.nome) && (
                  <button
                    type="button"
                    onClick={() => handleRemoveDipendente(editingDip.id)}
                    className="flex-1 bg-red-600 text-white font-bold px-4 py-3 rounded-xl hover:bg-red-700 transition active:scale-95 text-xs cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-4 h-4" /> Elimina Risorsa
                  </button>
                )}
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 text-white font-bold px-4 py-3 rounded-xl hover:bg-indigo-750 transition active:scale-95 text-xs cursor-pointer"
                >
                  Salva Modifiche
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modale di Anteprima Grafica HTML Live per Template E-mail */}
      {isMailPreviewModalOpen && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-4xl w-full max-h-[90vh] border border-gray-100 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 bg-indigo-900 text-white flex justify-between items-center">
              <h3 className="font-extrabold text-base flex items-center gap-2">
                <Eye className="w-5 h-5 text-indigo-300" /> Anteprima Grafica HTML: {currentTmplDef.label}
              </h3>
              <button
                type="button"
                onClick={() => setIsMailPreviewModalOpen(false)}
                className="hover:bg-white/20 p-1.5 rounded-xl transition text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-gray-100 flex-1 overflow-y-auto">
              {(() => {
                const sampleVars: Record<string, string> = {};
                currentTmplDef.placeholders.forEach(p => { sampleVars[p.code] = p.sample; });
                const renderedSubj = substitutePlaceholders(editSubject, sampleVars);
                const renderedBody = substitutePlaceholders(editBody, sampleVars);
                const fullWrappedHtml = wrapMailTemplate(renderedSubj, renderedBody);

                return (
                  <iframe
                    title="Full Mail Preview"
                    srcDoc={fullWrappedHtml}
                    className="w-full h-[650px] bg-white rounded-xl border border-gray-200 shadow-sm"
                  />
                );
              })()}
            </div>
            <div className="p-4 bg-white border-t flex justify-end gap-3">
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
                className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition flex items-center gap-2 shadow cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" /> Invia Mail di Prova
              </button>
            </div>
          </div>
        </div>
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
