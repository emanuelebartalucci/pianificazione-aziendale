import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth, isTechnicalUser } from '../contexts/AuthContext';
import { isCollaboratore, isSoci } from '../pages/Impostazioni';
import { db } from '../services/firebase';
import { collection, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { Users, Crown, Pencil, Plus, Search, Printer, UserX, X } from 'lucide-react';
import { APP_VERSION, getPrintDateString } from '../config/version';
import ConfirmModal from './ConfirmModal';

export default function AnagraficaRisorseSection() {
  const { dipendenti, refreshData } = useAuth();

  // Toast & Confirm state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);
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

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
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

  // Add form states
  const [newDipNome, setNewDipNome] = useState('');
  const [newDipEmail, setNewDipEmail] = useState('');
  const [newDipMacroArea, setNewDipMacroArea] = useState('');
  const [newDipDataNascita, setNewDipDataNascita] = useState('');

  const [newCollabNome, setNewCollabNome] = useState('');
  const [newCollabEmail, setNewCollabEmail] = useState('');
  const [newCollabMacroArea, setNewCollabMacroArea] = useState('');
  const [newCollabDataNascita, setNewCollabDataNascita] = useState('');

  // Search states
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
  const [editOrarioSettimanale, setEditOrarioSettimanale] = useState<Record<string, number | ''>>({
    lun: 8, mar: 8, mer: 8, gio: 8, ven: 8
  });

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

      const isSocio = isSoci(editingDip.nome);
      const todayStr = new Date().toISOString().split('T')[0];
      const payload: any = {
        nome: editNome.trim(),
        email: editEmail.trim().toLowerCase(),
        tipo: isSocio ? 'dipendente' : editTipo,
        macroArea: isSocio ? null : (editMacroArea || null),
        dataCessazione: isSocio ? null : (editDataCessazione || null),
        dataNascita: editDataNascita || null,
        orarioSettimanale: (isSocio || editTipo === 'collaboratore') ? null : cleanOrario,
        oreContratto: (isSocio || editTipo === 'collaboratore') ? null : avgDaily,
      };

      if (!isSocio && editDataCessazione && editDataCessazione <= todayStr) {
        payload.notificheEmail = false;
      }

      if (!isSocio && editTipo === 'collaboratore') {
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

  const handleAddDipendente = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newDipNome) {
      await addDoc(collection(db, 'dipendenti'), { 
        nome: newDipNome.trim(), 
        email: newDipEmail.toLowerCase().trim(),
        tipo: 'dipendente',
        macroArea: newDipMacroArea || null,
        dataNascita: newDipDataNascita || null
      });
      await refreshData();
      setNewDipNome('');
      setNewDipEmail('');
      setNewDipMacroArea('');
      setNewDipDataNascita('');
      showToast("Dipendente aggiunto con successo!", "success");
    }
  };

  const handleAddCollaboratore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newCollabNome) {
      await addDoc(collection(db, 'dipendenti'), { 
        nome: newCollabNome.trim(), 
        email: newCollabEmail.toLowerCase().trim(),
        tipo: 'collaboratore',
        macroArea: newCollabMacroArea || null,
        dataNascita: newCollabDataNascita || null
      });
      await refreshData();
      setNewCollabNome('');
      setNewCollabEmail('');
      setNewCollabMacroArea('');
      setNewCollabDataNascita('');
      showToast("Collaboratore aggiunto con successo!", "success");
    }
  };

  const handlePrintDipendenti = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const todayStr = new Date().toLocaleDateString('sv-SE');
    const listAttivi = dipendenti
      .filter(d => !isCollaboratore(d.nome, d.tipo) && !isSoci(d.nome) && !isTechnicalUser(d) && (!d.dataCessazione || d.dataCessazione >= todayStr))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));

    const listCessati = dipendenti
      .filter(d => !isCollaboratore(d.nome, d.tipo) && !isSoci(d.nome) && !isTechnicalUser(d) && d.dataCessazione && d.dataCessazione < todayStr)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
    
    const rowsAttiviHtml = listAttivi.length === 0 ? `
      <tr>
        <td colspan="4" style="text-align: center; padding: 20px; color: #9ca3af; font-weight: 700;">
          Nessun dipendente in forza censito.
        </td>
      </tr>
    ` : listAttivi.map((d, idx) => {
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

    const rowsCessatiHtml = listCessati.map((d, idx) => {
      const rowBg = idx % 2 === 1 ? 'background-color: #f8fafc;' : 'background-color: #ffffff;';
      const area = d.macroArea || 'Dipendente';
      const dateFormatted = d.dataCessazione ? d.dataCessazione.split('-').reverse().join('/') : '—';
      return `
        <tr style="${rowBg}; color: #475569;">
          <td style="padding: 4px 6px; border: 1px solid #cbd5e1; text-align: center; font-weight: 800;">${idx + 1}</td>
          <td style="padding: 4px 6px; border: 1px solid #cbd5e1; font-weight: 700; color: #334155;">${d.nome}</td>
          <td style="padding: 4px 6px; border: 1px solid #cbd5e1; font-weight: 600; color: #64748b;">${area}</td>
          <td style="padding: 4px 6px; border: 1px solid #cbd5e1; font-weight: 500; color: #64748b;">${d.email || '—'}</td>
          <td style="padding: 4px 6px; border: 1px solid #cbd5e1; text-align: center; font-weight: 800; color: #b91c1c;">${dateFormatted}</td>
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

          .cessati-section-header { margin-top: 18px; margin-bottom: 6px; background-color: #475569; color: #ffffff; padding: 5px 10px; border-radius: 5px; display: flex; justify-content: space-between; align-items: center; break-inside: avoid; }
          .cessati-section-text { font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; }
          
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
                  <span class="title-banner-text">ANAGRAFICA DIPENDENTI TEAM (IN FORZA)</span>
                  <span class="count-badge">${listAttivi.length} DIPENDENTE/I IN FORZA</span>
                </div>
              </td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div class="filter-box">
                  <span><strong>Data Stampa:</strong> ${getPrintDateString()}</span>
                  <span><strong>Dipendenti in Forza:</strong> ${listAttivi.length}</span>
                  ${listCessati.length > 0 ? `<span><strong>Dipendenti Cessati:</strong> ${listCessati.length}</span>` : ''}
                </div>

                <table class="report-table">
                  <thead>
                    <tr>
                      <th style="width: 8%; text-align: center;">#</th>
                      <th style="width: 35%; text-align: left;">Nome Completo</th>
                      <th style="width: 25%; text-align: left;">Macro Area</th>
                      <th style="width: 32%; text-align: left;">Email Aziendale</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rowsAttiviHtml}
                  </tbody>
                </table>

                ${listCessati.length > 0 ? `
                  <div class="cessati-section-header">
                    <span class="cessati-section-text">DIPENDENTI CESSATI ARCHIVIATI</span>
                    <span class="count-badge">${listCessati.length} CESSATO/I</span>
                  </div>
                  <table class="report-table">
                    <thead>
                      <tr>
                        <th style="width: 7%; text-align: center;">#</th>
                        <th style="width: 31%; text-align: left;">Nome Completo</th>
                        <th style="width: 22%; text-align: left;">Macro Area</th>
                        <th style="width: 25%; text-align: left;">Email Aziendale</th>
                        <th style="width: 15%; text-align: center;">Data Cessazione</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rowsCessatiHtml}
                    </tbody>
                  </table>
                ` : ''}
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

    const todayStr = new Date().toLocaleDateString('sv-SE');
    const listCollabAttivi = dipendenti
      .filter(d => isCollaboratore(d.nome, d.tipo) && !isSoci(d.nome) && !isTechnicalUser(d) && (!d.dataCessazione || d.dataCessazione >= todayStr))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));

    const listCollabCessati = dipendenti
      .filter(d => isCollaboratore(d.nome, d.tipo) && !isSoci(d.nome) && !isTechnicalUser(d) && d.dataCessazione && d.dataCessazione < todayStr)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
    
    const rowsAttiviHtml = listCollabAttivi.length === 0 ? `
      <tr>
        <td colspan="4" style="text-align: center; padding: 20px; color: #9ca3af; font-weight: 700;">
          Nessun collaboratore esterno attivo censito.
        </td>
      </tr>
    ` : listCollabAttivi.map((c, idx) => {
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

    const rowsCessatiHtml = listCollabCessati.map((c, idx) => {
      const rowBg = idx % 2 === 1 ? 'background-color: #f8fafc;' : 'background-color: #ffffff;';
      const area = c.macroArea || 'Collaboratore';
      const dateFormatted = c.dataCessazione ? c.dataCessazione.split('-').reverse().join('/') : '—';
      return `
        <tr style="${rowBg}; color: #475569;">
          <td style="padding: 4px 6px; border: 1px solid #cbd5e1; text-align: center; font-weight: 800;">${idx + 1}</td>
          <td style="padding: 4px 6px; border: 1px solid #cbd5e1; font-weight: 700; color: #334155;">${c.nome}</td>
          <td style="padding: 4px 6px; border: 1px solid #cbd5e1; font-weight: 600; color: #64748b;">${area}</td>
          <td style="padding: 4px 6px; border: 1px solid #cbd5e1; font-weight: 500; color: #64748b;">${c.email || '—'}</td>
          <td style="padding: 4px 6px; border: 1px solid #cbd5e1; text-align: center; font-weight: 800; color: #b91c1c;">${dateFormatted}</td>
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

          .cessati-section-header { margin-top: 18px; margin-bottom: 6px; background-color: #475569; color: #ffffff; padding: 5px 10px; border-radius: 5px; display: flex; justify-content: space-between; align-items: center; break-inside: avoid; }
          .cessati-section-text { font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; }
          
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
                  <span class="title-banner-text">ANAGRAFICA COLLABORATORI ESTERNI (IN FORZA)</span>
                  <span class="count-badge">${listCollabAttivi.length} COLLAB. ATTIVI</span>
                </div>
              </td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div class="filter-box">
                  <span><strong>Data Stampa:</strong> ${getPrintDateString()}</span>
                  <span><strong>Collaboratori in Forza:</strong> ${listCollabAttivi.length}</span>
                  ${listCollabCessati.length > 0 ? `<span><strong>Collaboratori Cessati:</strong> ${listCollabCessati.length}</span>` : ''}
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
                    ${rowsAttiviHtml}
                  </tbody>
                </table>

                ${listCollabCessati.length > 0 ? `
                  <div class="cessati-section-header">
                    <span class="cessati-section-text">COLLABORATORI CESSATI ARCHIVIATI</span>
                    <span class="count-badge">${listCollabCessati.length} CESSATO/I</span>
                  </div>
                  <table class="report-table">
                    <thead>
                      <tr>
                        <th style="width: 7%; text-align: center;">#</th>
                        <th style="width: 31%; text-align: left;">Nome Completo</th>
                        <th style="width: 22%; text-align: left;">Macro Area / Ruolo</th>
                        <th style="width: 25%; text-align: left;">Email Contatto</th>
                        <th style="width: 15%; text-align: center;">Data Cessazione</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rowsCessatiHtml}
                    </tbody>
                  </table>
                ` : ''}
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

  return (
    <div className="space-y-8 w-full">
      {/* 1. SEZIONE IN EVIDENZA: SOCI PROPRIETARI */}
      <section className="bg-gradient-to-r from-amber-500/10 via-amber-400/5 to-transparent p-6 rounded-3xl border border-amber-200 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-amber-500 text-white rounded-xl shadow-md">
            <Crown className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-black text-amber-950 flex items-center gap-2">
              Soci Proprietari
            </h3>
            <p className="text-xs text-amber-800/80">
              Profili proprietari con accesso completo e privilegi direzionali permanenti.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dipendenti
            .filter(d => isSoci(d.nome))
            .map(socio => (
              <div 
                key={socio.id} 
                className="bg-white/80 backdrop-blur-xs p-4 rounded-2xl border border-amber-200/80 flex items-center justify-between shadow-xs hover:shadow-md transition"
              >
                <div className="flex items-center gap-3.5 min-w-0 pr-2">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 font-black flex items-center justify-center text-sm shadow-inner shrink-0">
                    {socio.nome.split(' ').map((n: string) => n[0]).join('')}
                  </div>
                  <div className="min-w-0">
                    <div className="font-extrabold text-slate-900 text-sm truncate">{socio.nome}</div>
                    <div className="text-xs text-amber-700 font-semibold truncate">{socio.email || 'Nessuna email'}</div>
                    {socio.dataNascita && (
                      <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                        🎂 Nascita: {socio.dataNascita.split('-').reverse().join('/')}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
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

      {/* 2. GRIGLIA A 2 COLONNE: DIPENDENTI E COLLABORATORI */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Anagrafica Dipendenti */}
        <section className="bg-gradient-to-br from-indigo-50 to-slate-50 p-6 rounded-3xl border border-indigo-100 shadow-sm flex flex-col">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-xl font-bold text-indigo-900 flex items-center gap-2">
              <Users className="w-6 h-6 text-indigo-600" /> Anagrafica Dipendenti
            </h3>
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
                  <button type="submit" className="bg-indigo-600 text-white px-4 rounded-xl hover:bg-indigo-700 transition font-bold shadow-md active:scale-95 flex items-center gap-1 shrink-0 cursor-pointer">
                    <Plus className="w-4 h-4"/> Aggiungi
                  </button>
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
            <h3 className="text-xl font-bold text-amber-900 flex items-center gap-2">
              <Users className="w-6 h-6 text-amber-600" /> Anagrafica Collaboratori P. IVA
            </h3>
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
                  <button type="submit" className="bg-amber-600 text-white px-4 rounded-xl hover:bg-amber-700 transition font-bold shadow-md active:scale-95 flex items-center gap-1 shrink-0 cursor-pointer">
                    <Plus className="w-4 h-4"/> Aggiungi
                  </button>
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

      {/* Sleek Edit Employee Modal */}
      {isEditModalOpen && editingDip && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[999999] p-4 overflow-y-auto animate-in fade-in duration-200">
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
              {/* Cognome e Nome */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">
                  Cognome e Nome {isSoci(editingDip.nome) && '(Socio Proprietario - Non Modificabile)'}
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

              {/* Macro Area (Solo non Soci) */}
              {!isSoci(editingDip.nome) && (
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Macro Area di Appartenenza</label>
                  <select
                    value={editMacroArea}
                    onChange={e => setEditMacroArea(e.target.value)}
                    className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition font-bold text-gray-705 text-xs"
                  >
                    <option value="">Nessuna Macro Area (Non assegnato)</option>
                    <option value="Disegnatori">Disegnatori</option>
                    <option value="Ingegneria">Ingegneria</option>
                    <option value="Sicurezza Cantieri">Sicurezza Cantieri</option>
                    <option value="Consulenza Sicurezza">Consulenza Sicurezza</option>
                    <option value="Amministrazione">Amministrazione</option>
                  </select>
                </div>
              )}

              {/* Data di Nascita */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Data di Nascita</label>
                <input
                  type="date"
                  value={editDataNascita}
                  onChange={e => setEditDataNascita(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition font-bold text-gray-705 text-xs cursor-pointer"
                />
              </div>

              {/* Orario Settimanale (Solo Dipendenti NON Soci) */}
              {!isSoci(editingDip.nome) && editTipo === 'dipendente' && (
                <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100 space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="block text-xs font-bold text-indigo-900">Orario Contrattuale Settimanale</label>
                    <span className="text-xs font-extrabold text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded-md">
                      Totale: {Object.values(editOrarioSettimanale).reduce((a, b) => (Number(a) || 0) + (Number(b) || 0), 0)}h / sett
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {(['lun', 'mar', 'mer', 'gio', 'ven'] as const).map(day => (
                      <div key={day} className="text-center">
                        <span className="block text-[10px] font-bold uppercase text-indigo-800 mb-1">{day}</span>
                        <input
                          type="number"
                          min="0"
                          max="12"
                          step="0.5"
                          value={editOrarioSettimanale[day]}
                          onChange={e => setEditOrarioSettimanale({
                            ...editOrarioSettimanale,
                            [day]: e.target.value === '' ? '' : parseFloat(e.target.value) || 0
                          })}
                          className="w-full p-2 text-center border border-indigo-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-400 font-bold text-xs outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Condizioni Economiche (Solo Collaboratori NON Soci) */}
              {!isSoci(editingDip.nome) && editTipo === 'collaboratore' && (
                <div className="bg-amber-50/60 p-4 rounded-2xl border border-amber-100 space-y-4">
                  <div className="flex items-center gap-2 border-b border-amber-200/60 pb-2">
                    <span className="font-extrabold text-xs text-amber-900">Tariffario e Regime Fiscale Collaboratore</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-gray-600 mb-1">Compenso Fisso Mensile (€)</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Es. 2500"
                        value={editImportoFisso}
                        onChange={e => setEditImportoFisso(e.target.value)}
                        className="w-full p-2.5 border border-amber-200 rounded-xl bg-white focus:ring-2 focus:ring-amber-400 font-bold text-xs outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-gray-600 mb-1">Tariffa Giornaliera (€/giorno)</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Es. 150"
                        value={editDailyRate}
                        onChange={e => setEditDailyRate(e.target.value)}
                        className="w-full p-2.5 border border-amber-200 rounded-xl bg-white focus:ring-2 focus:ring-amber-400 font-bold text-xs outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-gray-600 mb-1">Rivalsa INPS (%)</label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Es. 4"
                        value={editInpsRate}
                        onChange={e => setEditInpsRate(e.target.value)}
                        className="w-full p-2.5 border border-amber-200 rounded-xl bg-white focus:ring-2 focus:ring-amber-400 font-bold text-xs outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-gray-600 mb-1">IVA (%)</label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Es. 22"
                        value={editIvaRate}
                        onChange={e => setEditIvaRate(e.target.value)}
                        className="w-full p-2.5 border border-amber-200 rounded-xl bg-white focus:ring-2 focus:ring-amber-400 font-bold text-xs outline-none"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-gray-600 mb-1">Ritenuta d'Acconto (%)</label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Es. 20"
                        value={editRaRate}
                        onChange={e => setEditRaRate(e.target.value)}
                        className="w-full p-2.5 border border-amber-200 rounded-xl bg-white focus:ring-2 focus:ring-amber-400 font-bold text-xs outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Data Cessazione Lavoro (Solo NON Soci) */}
              {!isSoci(editingDip.nome) && (
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">Data Cessazione Rapporto Lavorativo (Opzionale)</label>
                  <input
                    type="date"
                    value={editDataCessazione}
                    onChange={e => setEditDataCessazione(e.target.value)}
                    className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition font-bold text-gray-705 text-xs cursor-pointer"
                  />
                  <p className="text-[10.5px] text-gray-400 font-medium mt-1 ml-1">
                    Se impostata una data antecedente a oggi, la risorsa sarà archiviata tra i cessati e non riceverà più notifiche né potrà accedere.
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-between items-center pt-4 border-t border-gray-100">
                {!isSoci(editingDip.nome) ? (
                  <button
                    type="button"
                    onClick={() => {
                      triggerConfirm(
                        "Rimuovi Risorsa",
                        `Sei sicuro di voler eliminare definitivamente ${editingDip.nome}? Questa azione non può essere annullata.`,
                        async () => {
                          try {
                            await deleteDoc(doc(db, 'dipendenti', editingDip.id));
                            await refreshData();
                            setIsEditModalOpen(false);
                            setEditingDip(null);
                            showToast("Risorsa rimossa con successo.", "success");
                          } catch (err) {
                            console.error("Errore eliminazione:", err);
                            showToast("Errore durante l'eliminazione.", "error");
                          }
                        },
                        'danger'
                      );
                    }}
                    className="px-4 py-2.5 text-rose-600 hover:bg-rose-50 rounded-xl font-bold text-xs transition cursor-pointer"
                  >
                    Elimina Definitivamente
                  </button>
                ) : <div />}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setIsEditModalOpen(false); setEditingDip(null); }}
                    className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs transition cursor-pointer"
                  >
                    Annulla
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs transition shadow-md shadow-indigo-200 cursor-pointer"
                  >
                    Salva Modifiche
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl border text-sm font-bold ${
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
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
        type={confirmConfig.type}
      />
    </div>
  );
}
