import { db } from '../services/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export interface EmailTemplateDefinition {
  id: string;
  label: string;
  category: 'Commesse' | 'Ferie & Assenze' | 'Presenze';
  defaultSubject: string;
  defaultBody: string;
  placeholders: { code: string; label: string; sample: string }[];
}

export const EMAIL_TEMPLATES_LIST: EmailTemplateDefinition[] = [
  {
    id: 'commessa_apertura',
    label: 'Notifica Apertura Nuova Commessa',
    category: 'Commesse',
    defaultSubject: '[Apertura Commessa] {CODICE_COMMESSA} - {NOME_COMMESSA}',
    defaultBody: `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; max-width: 780px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08);">
  
  <div style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #1e3a8a 100%); padding: 26px; color: #ffffff;">
    <table border="0" cellpadding="0" cellspacing="0" style="width: 100%;">
      <tr>
        <td>
          <div style="font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #93c5fd; margin-bottom: 6px;">
            Scheda Apertura Nuova Commessa
          </div>
          <h1 style="margin: 0; font-size: 22px; font-weight: 900; color: #ffffff; line-height: 1.25;">
            {CODICE_COMMESSA} — {NOME_COMMESSA}
          </h1>
          <div style="margin-top: 10px; font-size: 13px; color: #e2e8f0; font-weight: 600;">
            💼 Cliente: <strong style="color: #ffffff;">{CLIENTE}</strong>
          </div>
        </td>
        <td style="text-align: right; vertical-align: top; width: 110px;">
          <span style="background-color: #10b981; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
            🟢 APERTA
          </span>
        </td>
      </tr>
    </table>
  </div>

  <div style="padding: 26px;">
    
    <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 20px; line-height: 1.5; font-weight: 600;">
      Notifica di apertura nuova commessa sulla piattaforma di pianificazione aziendale con i seguenti dettagli:
    </p>

    <h3 style="margin-top: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px; color: #1e1b4b; border-bottom: 2px solid #6366f1; padding-bottom: 8px; margin-bottom: 16px; font-weight: 900;">
      📋 Anagrafica Generale & Impostazioni Commessa
    </h3>

    <table border="0" cellpadding="10" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; margin-bottom: 26px; background-color: #f8fafc; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; width: 220px; color: #475569; background-color: #f1f5f9;">Codice Commessa:</td>
        <td style="font-weight: 900; color: #0f172a; font-size: 14px;">{CODICE_COMMESSA}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Titolo Commessa:</td>
        <td style="font-weight: 800; color: #0f172a;">{NOME_COMMESSA}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Cliente:</td>
        <td style="font-weight: 800; color: #1d4ed8;">{CLIENTE}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Data Apertura Registrata:</td>
        <td style="font-weight: 800; color: #047857;">{DATA_APERTURA}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Anno di Riferimento:</td>
        <td style="font-weight: 700; color: #0f172a;">{ANNO}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Tipologia Commessa:</td>
        <td style="font-weight: 700; color: #0f172a;">{TIPOLOGIA}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Periodo di Esecuzione:</td>
        <td style="font-weight: 700; color: #334155;">Da: <strong>{DATA_INIZIO}</strong> a: <strong>{DATA_FINE}</strong></td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Responsabile Commessa:</td>
        <td style="font-weight: 800; color: #0f172a;">{RESPONSABILE}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Project Manager (PM):</td>
        <td style="font-weight: 800; color: #312e81;">{PM}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Utenti Abilitati sulla Commessa:</td>
        <td style="font-weight: 700; color: #047857;">{UTENTI_ABILITATI}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Gestione SGQ / Giornate Stimate:</td>
        <td style="font-weight: 700; color: #334155;">{GIORNATE_STIMATE}</td>
      </tr>
      <tr>
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Registrata / Aperta Da:</td>
        <td style="font-weight: 600; color: #047857;">{APERTA_DA}</td>
      </tr>
    </table>

    <h3 style="margin-top: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px; color: #1e1b4b; border-bottom: 2px solid #6366f1; padding-bottom: 8px; margin-bottom: 16px; font-weight: 900;">
      🔀 Elenco Progetti della Commessa
    </h3>

    {TABELLA_PROGETTI}

  </div>

</div>`,
    placeholders: [
      { code: '{CODICE_COMMESSA}', label: 'Codice Commessa', sample: '2026-042' },
      { code: '{NOME_COMMESSA}', label: 'Nome Commessa', sample: 'Progettazione Impianti Idrici' },
      { code: '{CLIENTE}', label: 'Cliente', sample: 'Acque S.p.A.' },
      { code: '{DATA_APERTURA}', label: 'Data Apertura Registrata', sample: '07/08/2026 ore 16:15' },
      { code: '{TIPOLOGIA}', label: 'Tipologia', sample: 'P - Progettazione' },
      { code: '{ANNO}', label: 'Anno', sample: '2026' },
      { code: '{APERTA_DA}', label: 'Operatore Apertura', sample: 'Bartalucci Emanuele' },
      { code: '{DATA_INIZIO}', label: 'Data Inizio', sample: '01/09/2026' },
      { code: '{DATA_FINE}', label: 'Data Fine', sample: '31/12/2026' },
      { code: '{RESPONSABILE}', label: 'Responsabile Commessa', sample: 'Profeti Andrea' },
      { code: '{PM}', label: 'Project Manager (PM)', sample: 'Profeti Andrea' },
      { code: '{TABELLA_PROGETTI}', label: 'Elenco Nomi Progetti', sample: `<div style="background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);"><ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #0f172a; line-height: 1.8; font-weight: 700;"><li>Progettazione Esecutiva Impianti Idrici e Termici</li><li>Direzione Lavori & Coordinamento Sicurezza in Cantiere</li></ul></div>` },
    ]
  },
  {
    id: 'commessa_chiusura',
    label: 'Notifica Chiusura Commessa',
    category: 'Commesse',
    defaultSubject: '[Chiusura Commessa] {CODICE_COMMESSA} - {NOME_COMMESSA}',
    defaultBody: `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; max-width: 780px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08);">
  
  <div style="background: linear-gradient(135deg, #0f172a 0%, #4c0519 50%, #881337 100%); padding: 26px; color: #ffffff;">
    <table border="0" cellpadding="0" cellspacing="0" style="width: 100%;">
      <tr>
        <td>
          <div style="font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #fecdd3; margin-bottom: 6px;">
            Scheda Chiusura Commessa
          </div>
          <h1 style="margin: 0; font-size: 22px; font-weight: 900; color: #ffffff; line-height: 1.25;">
            {CODICE_COMMESSA} — {NOME_COMMESSA}
          </h1>
          <div style="margin-top: 10px; font-size: 13px; color: #ffe4e6; font-weight: 600;">
            💼 Cliente: <strong style="color: #ffffff;">{CLIENTE}</strong>
          </div>
        </td>
        <td style="text-align: right; vertical-align: top; width: 110px;">
          <span style="background-color: #e11d48; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
            🔴 CHIUSA
          </span>
        </td>
      </tr>
    </table>
  </div>

  <div style="padding: 26px;">
    
    <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 20px; line-height: 1.5; font-weight: 600;">
      Notifica di avvenuta chiusura della commessa sulla piattaforma di pianificazione aziendale con i seguenti dettagli:
    </p>

    <h3 style="margin-top: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px; color: #881337; border-bottom: 2px solid #f43f5e; padding-bottom: 8px; margin-bottom: 16px; font-weight: 900;">
      📋 Anagrafica Generale & Impostazioni Commessa
    </h3>

    <table border="0" cellpadding="10" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; margin-bottom: 26px; background-color: #fff1f2; border-radius: 12px; overflow: hidden; border: 1px solid #fecdd3;">
      <tr style="border-bottom: 1px solid #fecdd3;">
        <td style="font-weight: bold; width: 220px; color: #881337; background-color: #ffe4e6;">Codice Commessa:</td>
        <td style="font-weight: 900; color: #0f172a; font-size: 14px;">{CODICE_COMMESSA}</td>
      </tr>
      <tr style="border-bottom: 1px solid #fecdd3;">
        <td style="font-weight: bold; color: #881337; background-color: #ffe4e6;">Titolo Commessa:</td>
        <td style="font-weight: 800; color: #0f172a;">{NOME_COMMESSA}</td>
      </tr>
      <tr style="border-bottom: 1px solid #fecdd3;">
        <td style="font-weight: bold; color: #881337; background-color: #ffe4e6;">Cliente:</td>
        <td style="font-weight: 800; color: #1d4ed8;">{CLIENTE}</td>
      </tr>
      <tr style="border-bottom: 1px solid #fecdd3;">
        <td style="font-weight: bold; color: #881337; background-color: #ffe4e6;">Data Chiusura Registrata:</td>
        <td style="font-weight: 800; color: #be123c;">{DATA_CHIUSURA}</td>
      </tr>
      <tr style="border-bottom: 1px solid #fecdd3;">
        <td style="font-weight: bold; color: #881337; background-color: #ffe4e6;">Anno di Riferimento:</td>
        <td style="font-weight: 700; color: #0f172a;">{ANNO}</td>
      </tr>
      <tr style="border-bottom: 1px solid #fecdd3;">
        <td style="font-weight: bold; color: #881337; background-color: #ffe4e6;">Tipologia Commessa:</td>
        <td style="font-weight: 700; color: #0f172a;">{TIPOLOGIA}</td>
      </tr>
      <tr style="border-bottom: 1px solid #fecdd3;">
        <td style="font-weight: bold; color: #881337; background-color: #ffe4e6;">Periodo di Esecuzione:</td>
        <td style="font-weight: 700; color: #334155;">Da: <strong>{DATA_INIZIO}</strong> a: <strong>{DATA_FINE}</strong></td>
      </tr>
      <tr style="border-bottom: 1px solid #fecdd3;">
        <td style="font-weight: bold; color: #881337; background-color: #ffe4e6;">Responsabile Commessa:</td>
        <td style="font-weight: 800; color: #0f172a;">{RESPONSABILE}</td>
      </tr>
      <tr style="border-bottom: 1px solid #fecdd3;">
        <td style="font-weight: bold; color: #881337; background-color: #ffe4e6;">Project Manager (PM):</td>
        <td style="font-weight: 800; color: #312e81;">{PM}</td>
      </tr>
      <tr style="border-bottom: 1px solid #fecdd3;">
        <td style="font-weight: bold; color: #881337; background-color: #ffe4e6;">Utenti Abilitati sulla Commessa:</td>
        <td style="font-weight: 700; color: #047857;">{UTENTI_ABILITATI}</td>
      </tr>
      <tr style="border-bottom: 1px solid #fecdd3;">
        <td style="font-weight: bold; color: #881337; background-color: #ffe4e6;">Gestione SGQ / Giornate Stimate:</td>
        <td style="font-weight: 700; color: #334155;">{GIORNATE_STIMATE}</td>
      </tr>
      <tr>
        <td style="font-weight: bold; color: #881337; background-color: #ffe4e6;">Registrata / Chiusa Da:</td>
        <td style="font-weight: 700; color: #be123c;">{CHIUSA_DA}</td>
      </tr>
    </table>

    <h3 style="margin-top: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px; color: #881337; border-bottom: 2px solid #f43f5e; padding-bottom: 8px; margin-bottom: 16px; font-weight: 900;">
      🔀 Elenco Progetti della Commessa
    </h3>

    {TABELLA_PROGETTI}

    <div style="margin-top: 20px; padding: 12px 16px; background-color: #fef2f2; border: 1px solid #fecdd3; border-radius: 12px; font-size: 12px; color: #9f1239; font-weight: 600;">
      ℹ️ Nota: Le eventuali assegnazioni di ore pianificate per questa commessa nelle settimane successive alla chiusura sono state automaticamente rimosse.
    </div>

  </div>

</div>`,
    placeholders: [
      { code: '{CODICE_COMMESSA}', label: 'Codice Commessa', sample: '2026-042' },
      { code: '{NOME_COMMESSA}', label: 'Nome Commessa', sample: 'Progettazione Impianti Idrici' },
      { code: '{CLIENTE}', label: 'Cliente', sample: 'Acque S.p.A.' },
      { code: '{DATA_CHIUSURA}', label: 'Data Chiusura Registrata', sample: '07/08/2026 ore 16:24' },
      { code: '{TIPOLOGIA}', label: 'Tipologia', sample: 'P - Progettazione' },
      { code: '{ANNO}', label: 'Anno', sample: '2026' },
      { code: '{CHIUSA_DA}', label: 'Operatore Chiusura', sample: 'Bartalucci Emanuele' },
      { code: '{DATA_INIZIO}', label: 'Data Inizio', sample: '01/09/2026' },
      { code: '{DATA_FINE}', label: 'Data Fine', sample: '31/12/2026' },
      { code: '{RESPONSABILE}', label: 'Responsabile Commessa', sample: 'Profeti Andrea' },
      { code: '{PM}', label: 'Project Manager (PM)', sample: 'Profeti Andrea' },
      { code: '{UTENTI_ABILITATI}', label: 'Utenti Abilitati', sample: 'Cappelli Marco, Biagioni Matteo' },
      { code: '{GIORNATE_STIMATE}', label: 'Configurazione SGQ / Giornate Stimate', sample: 'SGQ: Sì (Validatori: Bartalucci Emanuele, Compilatore: Profeti Andrea)' },
      { code: '{TABELLA_PROGETTI}', label: 'Elenco Nomi Progetti', sample: `<div style="background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);"><ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #0f172a; line-height: 1.8; font-weight: 700;"><li>Progettazione Esecutiva Impianti Idrici e Termici</li><li>Direzione Lavori & Coordinamento Sicurezza in Cantiere</li></ul></div>` },
    ]
  },
  {
    id: 'commessa_assegnazione',
    label: 'Notifica Assegnazione Ruolo su Commessa (PM / Responsabile)',
    category: 'Commesse',
    defaultSubject: '[Notifica] Assegnazione Incarico su Commessa: {NOME_COMMESSA}',
    defaultBody: `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; max-width: 780px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08);">
  
  <div style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #4338ca 100%); padding: 26px; color: #ffffff;">
    <table border="0" cellpadding="0" cellspacing="0" style="width: 100%;">
      <tr>
        <td>
          <div style="font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #c7d2fe; margin-bottom: 6px;">
            Assegnazione Incarico su Commessa
          </div>
          <h1 style="margin: 0; font-size: 22px; font-weight: 900; color: #ffffff; line-height: 1.25;">
            {NOME_COMMESSA}
          </h1>
          <div style="margin-top: 10px; font-size: 13px; color: #e0e7ff; font-weight: 600;">
            👤 Risorsa: <strong style="color: #ffffff;">{NOME_DIPENDENTE}</strong>
          </div>
        </td>
        <td style="text-align: right; vertical-align: top; width: 130px;">
          <span style="background-color: #6366f1; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
            📌 {RUOLO_COMMESSA}
          </span>
        </td>
      </tr>
    </table>
  </div>

  <div style="padding: 26px;">
    <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 20px; line-height: 1.5; font-weight: 600;">
      Notifica di assegnazione nuovo incarico sulla piattaforma di pianificazione aziendale con i seguenti dettagli:
    </p>

    <table border="0" cellpadding="10" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; background-color: #f8fafc; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; width: 220px; color: #475569; background-color: #f1f5f9;">Risorsa Assegnata:</td>
        <td style="font-weight: 900; color: #0f172a;">{NOME_DIPENDENTE}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Ruolo Assegnato:</td>
        <td style="font-weight: 800; color: #4338ca;">{RUOLO_COMMESSA}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Commessa di Riferimento:</td>
        <td style="font-weight: 800; color: #0f172a;">{NOME_COMMESSA}</td>
      </tr>
      <tr>
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Periodo Previsto:</td>
        <td style="font-weight: 700; color: #334155;">Da: <strong>{DATA_INIZIO}</strong> a: <strong>{DATA_FINE}</strong></td>
      </tr>
    </table>
  </div>

</div>`,
    placeholders: [
      { code: '{NOME_DIPENDENTE}', label: 'Nome Risorsa', sample: 'Rossi Mario' },
      { code: '{RUOLO_COMMESSA}', label: 'Ruolo (PM / Responsabile)', sample: 'Project Manager (PM)' },
      { code: '{NOME_COMMESSA}', label: 'Nome Commessa', sample: 'Riqualificazione Area Nord' },
      { code: '{DATA_INIZIO}', label: 'Data Inizio', sample: '01/08/2026' },
      { code: '{DATA_FINE}', label: 'Data Fine', sample: '31/12/2026' },
    ]
  },
  {
    id: 'ferie_assegnazione_hr',
    label: 'Notifica Inserimento Assenza / Ferie da HR',
    category: 'Ferie & Assenze',
    defaultSubject: "[Notifica] Inserimento {TIPO_ASSENZA} da parte dell'HR",
    defaultBody: `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; max-width: 780px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08);">
  
  <div style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #1d4ed8 100%); padding: 26px; color: #ffffff;">
    <table border="0" cellpadding="0" cellspacing="0" style="width: 100%;">
      <tr>
        <td>
          <div style="font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #93c5fd; margin-bottom: 6px;">
            Inserimento Assenza da HR
          </div>
          <h1 style="margin: 0; font-size: 22px; font-weight: 900; color: #ffffff; line-height: 1.25;">
            {TIPO_ASSENZA} — {NOME_DIPENDENTE}
          </h1>
        </td>
        <td style="text-align: right; vertical-align: top; width: 140px;">
          <span style="background-color: #2563eb; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
            📌 REGISTRATO DA HR
          </span>
        </td>
      </tr>
    </table>
  </div>

  <div style="padding: 26px;">
    <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 20px; line-height: 1.5; font-weight: 600;">
      Notifica di inserimento assenza da parte dell'ufficio HR / Amministrazione con i seguenti dettagli:
    </p>

    <table border="0" cellpadding="10" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; background-color: #f8fafc; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; width: 220px; color: #475569; background-color: #f1f5f9;">Risorsa Interessata:</td>
        <td style="font-weight: 900; color: #0f172a;">{NOME_DIPENDENTE}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Tipologia Assenza:</td>
        <td style="font-weight: 800; color: #1d4ed8;">{TIPO_ASSENZA}</td>
      </tr>
      <tr>
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Periodo / Orario:</td>
        <td style="font-weight: 800; color: #047857;">{PERIODO_ASSENZA}</td>
      </tr>
    </table>
  </div>

</div>`,
    placeholders: [
      { code: '{NOME_DIPENDENTE}', label: 'Nome Risorsa', sample: 'Bartalucci Emanuele' },
      { code: '{TIPO_ASSENZA}', label: 'Tipo Assenza', sample: 'Ferie' },
      { code: '{PERIODO_ASSENZA}', label: 'Periodo / Orario', sample: 'dal 20/08/2026 al 21/08/2026' },
    ]
  },
  {
    id: 'ferie_annullamento_hr',
    label: 'Notifica Annullamento Assenza / Ferie da HR',
    category: 'Ferie & Assenze',
    defaultSubject: "[Notifica] Annullamento {TIPO_ASSENZA} da parte dell'HR",
    defaultBody: `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; max-width: 780px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08);">
  
  <div style="background: linear-gradient(135deg, #0f172a 0%, #881337 50%, #be123c 100%); padding: 26px; color: #ffffff;">
    <table border="0" cellpadding="0" cellspacing="0" style="width: 100%;">
      <tr>
        <td>
          <div style="font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #fecdd3; margin-bottom: 6px;">
            Annullamento Assenza da HR
          </div>
          <h1 style="margin: 0; font-size: 22px; font-weight: 900; color: #ffffff; line-height: 1.25;">
            {TIPO_ASSENZA} — {NOME_DIPENDENTE}
          </h1>
        </td>
        <td style="text-align: right; vertical-align: top; width: 120px;">
          <span style="background-color: #be123c; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
            🚫 ANNULLATA
          </span>
        </td>
      </tr>
    </table>
  </div>

  <div style="padding: 26px;">
    <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 20px; line-height: 1.5; font-weight: 600;">
      Notifica di annullamento dell'assenza da parte dell'ufficio HR / Amministrazione con i seguenti dettagli:
    </p>

    <table border="0" cellpadding="10" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; background-color: #fff1f2; border-radius: 12px; overflow: hidden; border: 1px solid #fecdd3;">
      <tr style="border-bottom: 1px solid #fecdd3;">
        <td style="font-weight: bold; width: 220px; color: #881337; background-color: #ffe4e6;">Risorsa Interessata:</td>
        <td style="font-weight: 900; color: #0f172a;">{NOME_DIPENDENTE}</td>
      </tr>
      <tr style="border-bottom: 1px solid #fecdd3;">
        <td style="font-weight: bold; color: #881337; background-color: #ffe4e6;">Tipologia Assenza:</td>
        <td style="font-weight: 800; color: #be123c;">{TIPO_ASSENZA}</td>
      </tr>
      <tr style="border-bottom: 1px solid #fecdd3;">
        <td style="font-weight: bold; color: #881337; background-color: #ffe4e6;">Periodo / Orario:</td>
        <td style="font-weight: 800; color: #0f172a;">{PERIODO_ASSENZA}</td>
      </tr>
      <tr>
        <td style="font-weight: bold; color: #881337; background-color: #ffe4e6;">Stato Precedente:</td>
        <td style="font-weight: 700; color: #475569;">{STATO_PRECEDENTE}</td>
      </tr>
    </table>

    <div style="margin-top: 20px; padding: 14px; background-color: #ffffff; border: 1px solid #fecdd3; border-radius: 12px; font-size: 13px; color: #881337;">
      {MOTIVAZIONE_HTML}
    </div>
  </div>

</div>`,
    placeholders: [
      { code: '{NOME_DIPENDENTE}', label: 'Nome Risorsa', sample: 'Bartalucci Emanuele' },
      { code: '{TIPO_ASSENZA}', label: 'Tipo Assenza', sample: 'Ferie' },
      { code: '{PERIODO_ASSENZA}', label: 'Periodo / Orario', sample: 'dal 20/08/2026 al 21/08/2026' },
      { code: '{STATO_PRECEDENTE}', label: 'Stato Precedente', sample: 'approvato' },
      { code: '{MOTIVAZIONE_HTML}', label: 'Motivazione Annullamento', sample: "<p style='margin:0;'><strong>Motivazione dell'annullamento:</strong> Spostamento esigenze di cantiere</p>" },
    ]
  },
  {
    id: 'ferie_decisione',
    label: 'Notifica Approvazione / Rifiuto Richiesta Assenza',
    category: 'Ferie & Assenze',
    defaultSubject: '[Notifica] Esito Richiesta {TIPO_ASSENZA}: {ESITO_DECISIONE}',
    defaultBody: `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; max-width: 780px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08);">
  
  <div style="background: linear-gradient(135deg, #0f172a 0%, #064e3b 50%, #047857 100%); padding: 26px; color: #ffffff;">
    <table border="0" cellpadding="0" cellspacing="0" style="width: 100%;">
      <tr>
        <td>
          <div style="font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #a7f3d0; margin-bottom: 6px;">
            Esito Richiesta Assenza
          </div>
          <h1 style="margin: 0; font-size: 22px; font-weight: 900; color: #ffffff; line-height: 1.25;">
            {TIPO_ASSENZA} — {NOME_DIPENDENTE}
          </h1>
        </td>
        <td style="text-align: right; vertical-align: top; width: 130px;">
          <span style="background-color: #059669; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
            📋 {ESITO_DECISIONE}
          </span>
        </td>
      </tr>
    </table>
  </div>

  <div style="padding: 26px;">
    <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 20px; line-height: 1.5; font-weight: 600;">
      Notifica dell'esito (approvazione / rifiuto) della richiesta di assenza con i seguenti dettagli:
    </p>

    <table border="0" cellpadding="10" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; background-color: #f0fdf4; border-radius: 12px; overflow: hidden; border: 1px solid #bbf7d0;">
      <tr style="border-bottom: 1px solid #bbf7d0;">
        <td style="font-weight: bold; width: 220px; color: #064e3b; background-color: #dcfce7;">Risorsa Richiedente:</td>
        <td style="font-weight: 900; color: #0f172a;">{NOME_DIPENDENTE}</td>
      </tr>
      <tr style="border-bottom: 1px solid #bbf7d0;">
        <td style="font-weight: bold; color: #064e3b; background-color: #dcfce7;">Tipologia Assenza:</td>
        <td style="font-weight: 800; color: #047857;">{TIPO_ASSENZA}</td>
      </tr>
      <tr style="border-bottom: 1px solid #bbf7d0;">
        <td style="font-weight: bold; color: #064e3b; background-color: #dcfce7;">Periodo / Orario:</td>
        <td style="font-weight: 800; color: #0f172a;">{PERIODO_ASSENZA}</td>
      </tr>
      <tr>
        <td style="font-weight: bold; color: #064e3b; background-color: #dcfce7;">Esito Richiesta:</td>
        <td style="font-weight: 900; color: #059669;">{ESITO_DECISIONE}</td>
      </tr>
    </table>
  </div>

</div>`,
    placeholders: [
      { code: '{NOME_DIPENDENTE}', label: 'Nome Risorsa', sample: 'Biagioni Matteo' },
      { code: '{TIPO_ASSENZA}', label: 'Tipo Assenza', sample: 'Permesso' },
      { code: '{PERIODO_ASSENZA}', label: 'Periodo / Orario', sample: 'il 14/08/2026 (pomeriggio)' },
      { code: '{ESITO_DECISIONE}', label: 'Esito (approvata/rifiutata)', sample: 'APPROVATA' },
    ]
  },
  {
    id: 'weekend_decisione',
    label: 'Notifica Approvazione / Rifiuto Lavoro Festivo / Weekend',
    category: 'Ferie & Assenze',
    defaultSubject: '[Notifica] Lavoro Festivo / Weekend: {ESITO_FESTIVO}',
    defaultBody: `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; max-width: 780px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08);">
  
  <div style="background: linear-gradient(135deg, #0f172a 0%, #3b0764 50%, #6b21a8 100%); padding: 26px; color: #ffffff;">
    <table border="0" cellpadding="0" cellspacing="0" style="width: 100%;">
      <tr>
        <td>
          <div style="font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #e9d5ff; margin-bottom: 6px;">
            Esito Richiesta Lavoro Festivo
          </div>
          <h1 style="margin: 0; font-size: 22px; font-weight: 900; color: #ffffff; line-height: 1.25;">
            Lavoro Festivo — {NOME_DIPENDENTE}
          </h1>
        </td>
        <td style="text-align: right; vertical-align: top; width: 140px;">
          <span style="background-color: #7e22ce; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
            📅 FESTIVO
          </span>
        </td>
      </tr>
    </table>
  </div>

  <div style="padding: 26px;">
    <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 20px; line-height: 1.5; font-weight: 600;">
      Notifica dell'esito (approvazione / rifiuto) per la richiesta di lavoro festivo / weekend con i seguenti dettagli:
    </p>

    <table border="0" cellpadding="10" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; background-color: #faf5ff; border-radius: 12px; overflow: hidden; border: 1px solid #e9d5ff;">
      <tr style="border-bottom: 1px solid #e9d5ff;">
        <td style="font-weight: bold; width: 220px; color: #581c87; background-color: #f3e8ff;">Risorsa Interessata:</td>
        <td style="font-weight: 900; color: #0f172a;">{NOME_DIPENDENTE}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e9d5ff;">
        <td style="font-weight: bold; color: #581c87; background-color: #f3e8ff;">Data Festivo / Weekend:</td>
        <td style="font-weight: 800; color: #6b21a8;">{DATA_FESTIVO}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e9d5ff;">
        <td style="font-weight: bold; color: #581c87; background-color: #f3e8ff;">Motivazione Intervento:</td>
        <td style="font-weight: 700; color: #334155;">{MOTIVAZIONE}</td>
      </tr>
      <tr>
        <td style="font-weight: bold; color: #581c87; background-color: #f3e8ff;">Esito Autorizzazione:</td>
        <td style="font-weight: 900; color: #7e22ce;">{ESITO_FESTIVO}</td>
      </tr>
    </table>

    <div style="margin-top: 20px; font-size: 13px; color: #581c87;">
      {INFO_PRESENZE_HTML}
    </div>
  </div>

</div>`,
    placeholders: [
      { code: '{NOME_DIPENDENTE}', label: 'Nome Risorsa', sample: 'Cappelli Marco' },
      { code: '{DATA_FESTIVO}', label: 'Data Festivo/Weekend', sample: '15/08/2026' },
      { code: '{MOTIVAZIONE}', label: 'Motivazione', sample: 'Intervento programmato in centrale' },
      { code: '{ESITO_FESTIVO}', label: 'Esito (approvata/rifiutata)', sample: 'APPROVATA' },
      { code: '{INFO_PRESENZE_HTML}', label: 'Indicazione Foglio Presenze', sample: "<p style='margin:0;'>Puoi procedere all'inserimento delle ore sul tuo foglio presenze.</p>" },
    ]
  },
  {
    id: 'presenze_sollecito',
    label: 'Notifica Sollecito / Richiesta Modifiche Presenze',
    category: 'Presenze',
    defaultSubject: '[Presenze] Sollecito / Richiesta Modifiche Rapportino {PERIODO_MESE}',
    defaultBody: `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; max-width: 780px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08);">
  
  <div style="background: linear-gradient(135deg, #0f172a 0%, #78350f 50%, #b45309 100%); padding: 26px; color: #ffffff;">
    <table border="0" cellpadding="0" cellspacing="0" style="width: 100%;">
      <tr>
        <td>
          <div style="font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #fde68a; margin-bottom: 6px;">
            Sollecito Presenze Mensili
          </div>
          <h1 style="margin: 0; font-size: 22px; font-weight: 900; color: #ffffff; line-height: 1.25;">
            Presenze — {PERIODO_MESE}
          </h1>
          <div style="margin-top: 10px; font-size: 13px; color: #fef3c7; font-weight: 600;">
            👤 Risorsa: <strong style="color: #ffffff;">{NOME_DIPENDENTE}</strong>
          </div>
        </td>
        <td style="text-align: right; vertical-align: top; width: 140px;">
          <span style="background-color: #d97706; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
            ⚠️ MODIFICHE HR
          </span>
        </td>
      </tr>
    </table>
  </div>

  <div style="padding: 26px;">
    <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 20px; line-height: 1.5; font-weight: 600;">
      L'ufficio HR / Amministrazione richiede verifiche o correzioni sul tuo rapportino presenze mensile:
    </p>

    <table border="0" cellpadding="10" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; margin-bottom: 20px; background-color: #fffbeb; border-radius: 12px; overflow: hidden; border: 1px solid #fde68a;">
      <tr style="border-bottom: 1px solid #fde68a;">
        <td style="font-weight: bold; width: 220px; color: #78350f; background-color: #fef3c7;">Risorsa Destinataria:</td>
        <td style="font-weight: 900; color: #0f172a;">{NOME_DIPENDENTE}</td>
      </tr>
      <tr>
        <td style="font-weight: bold; color: #78350f; background-color: #fef3c7;">Periodo di Riferimento:</td>
        <td style="font-weight: 800; color: #b45309;">{PERIODO_MESE}</td>
      </tr>
    </table>

    <div style="padding: 14px; background-color: #ffffff; border: 1px solid #fde68a; border-radius: 12px; font-size: 13px; color: #78350f;">
      {NOTE_HR_HTML}
    </div>
  </div>

</div>`,
    placeholders: [
      { code: '{NOME_DIPENDENTE}', label: 'Nome Risorsa', sample: 'Mancini Marco' },
      { code: '{PERIODO_MESE}', label: 'Mese ed Anno', sample: 'Luglio 2026' },
      { code: '{NOTE_HR_HTML}', label: 'Comunicazioni dall\'HR', sample: "<p style='margin:0;'><strong>Note HR:</strong> Mancano i rimborsi chilometrici del 12/07.</p>" },
    ]
  }
];

export async function loadSavedEmailTemplates(): Promise<Record<string, { subject: string; body: string }>> {
  try {
    const docSnap = await getDoc(doc(db, 'configurazioni', 'email_templates'));
    if (docSnap.exists()) {
      return docSnap.data() as Record<string, { subject: string; body: string }>;
    }
  } catch (err) {
    console.error("Errore lettura template e-mail da Firestore:", err);
  }
  return {};
}

export async function saveEmailTemplates(templates: Record<string, { subject: string; body: string }>) {
  const docRef = doc(db, 'configurazioni', 'email_templates');
  await setDoc(docRef, templates, { merge: true });
}

export function substitutePlaceholders(templateStr: string, sampleData: Record<string, string>): string {
  let result = templateStr;
  Object.keys(sampleData).forEach(key => {
    result = result.replaceAll(key, sampleData[key]);
  });
  return result;
}

export async function getCommesseNotificationEmails(): Promise<string[]> {
  try {
    const docSnap = await getDoc(doc(db, 'configurazioni', 'notifiche_commesse'));
    if (docSnap.exists() && Array.isArray(docSnap.data().emails) && docSnap.data().emails.length > 0) {
      return docSnap.data().emails.map((e: string) => e.toLowerCase().trim()).filter(Boolean);
    }
  } catch (err) {
    console.error("Errore lettura destinatari notifiche commesse:", err);
  }
  return [];
}

export async function saveCommesseNotificationEmails(emails: string[]): Promise<void> {
  const cleaned = Array.from(new Set(emails.map(e => e.toLowerCase().trim()).filter(Boolean)));
  const docRef = doc(db, 'configurazioni', 'notifiche_commesse');
  await setDoc(docRef, { emails: cleaned, updatedAt: new Date().toISOString() });
}
