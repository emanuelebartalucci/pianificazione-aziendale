import { db } from '../services/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export interface EmailTemplateDefinition {
  id: string;
  label: string;
  category: 'Commesse' | 'Presenze & Festivi';
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
    defaultBody: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; max-width: 680px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
  
  <!-- Header Dark Navy Email-Safe con Fallback Outlook -->
  <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#0f172a" style="width: 100%; background-color: #0f172a; background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #1e3a8a 100%);">
    <tr>
      <td bgcolor="#0f172a" style="background-color: #0f172a; padding: 26px; color: #ffffff;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width: 100%;">
          <tr>
            <td valign="top" style="vertical-align: top;">
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
            <td align="right" valign="top" style="text-align: right; vertical-align: top; width: 110px;">
              <span style="background-color: #10b981; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
                🟢 APERTA
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

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
      { code: '{UTENTI_ABILITATI}', label: 'Utenti Abilitati', sample: 'Cappelli Marco, Biagioni Matteo' },
      { code: '{GIORNATE_STIMATE}', label: 'Configurazione SGQ / Giornate Stimate', sample: 'SGQ: Sì (Validatori: Bartalucci Emanuele, Compilatore: Profeti Andrea)' },
      { code: '{TABELLA_PROGETTI}', label: 'Elenco Nomi Progetti', sample: `<div style="background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);"><ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #0f172a; line-height: 1.8; font-weight: 700;"><li>Progettazione Esecutiva Impianti Idrici e Termici</li><li>Direzione Lavori & Coordinamento Sicurezza in Cantiere</li></ul></div>` },
    ]
  },
  {
    id: 'commessa_chiusura',
    label: 'Notifica Chiusura Commessa',
    category: 'Commesse',
    defaultSubject: '[Chiusura Commessa] {CODICE_COMMESSA} - {NOME_COMMESSA}',
    defaultBody: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; max-width: 680px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
  
  <!-- Header Dark Red/Navy Email-Safe con Fallback Outlook -->
  <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#0f172a" style="width: 100%; background-color: #0f172a; background: linear-gradient(135deg, #0f172a 0%, #4c0519 50%, #881337 100%);">
    <tr>
      <td bgcolor="#0f172a" style="background-color: #0f172a; padding: 26px; color: #ffffff;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width: 100%;">
          <tr>
            <td valign="top" style="vertical-align: top;">
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
            <td align="right" valign="top" style="text-align: right; vertical-align: top; width: 110px;">
              <span style="background-color: #e11d48; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
                🔴 CHIUSA
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

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
    id: 'approvazione_lavoro_festivo',
    label: 'Notifica Approvazione Lavoro Weekend e Festivi',
    category: 'Presenze & Festivi',
    defaultSubject: '[Lavoro Festivo Approvato] {NOME_RISORSA} - {DATA_FESTIVO}',
    defaultBody: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; max-width: 680px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
  
  <!-- Header Dark Navy Email-Safe con Fallback Outlook -->
  <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#0f172a" style="width: 100%; background-color: #0f172a; background: linear-gradient(135deg, #0f172a 0%, #312e81 50%, #4338ca 100%);">
    <tr>
      <td bgcolor="#0f172a" style="background-color: #0f172a; padding: 26px; color: #ffffff;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width: 100%;">
          <tr>
            <td valign="top" style="vertical-align: top;">
              <div style="font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #a5b4fc; margin-bottom: 6px;">
                Autorizzazione Lavoro Straordinario / Festivo
              </div>
              <h1 style="margin: 0; font-size: 22px; font-weight: 900; color: #ffffff; line-height: 1.25;">
                {NOME_RISORSA} — {DATA_FESTIVO}
              </h1>
              <div style="margin-top: 10px; font-size: 13px; color: #e0e7ff; font-weight: 600;">
                🛡️ Approvato per lavoro nel weekend / festività
              </div>
            </td>
            <td align="right" valign="top" style="text-align: right; vertical-align: top; width: 130px;">
              <span style="background-color: #10b981; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
                🟢 AUTORIZZATO
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <div style="padding: 26px;">
    <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 20px; line-height: 1.5; font-weight: 600;">
      Notifica automatica: è stata approvata una richiesta di autorizzazione per lo svolgimento di attività lavorativa in giornata festiva o durante il fine settimana.
    </p>

    <h3 style="margin-top: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px; color: #1e1b4b; border-bottom: 2px solid #6366f1; padding-bottom: 8px; margin-bottom: 16px; font-weight: 900;">
      📋 Dettaglio Autorizzazione Lavoro Festivo
    </h3>

    <table border="0" cellpadding="10" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; margin-bottom: 24px; background-color: #f8fafc; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; width: 220px; color: #475569; background-color: #f1f5f9;">Risorsa Autorizzata:</td>
        <td style="font-weight: 900; color: #0f172a; font-size: 14px;">{NOME_RISORSA}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Data / Giorno Festivo:</td>
        <td style="font-weight: 800; color: #4338ca; font-size: 14px;">{DATA_FESTIVO}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Motivazione / Attività:</td>
        <td style="font-weight: 700; color: #0f172a;">{MOTIVAZIONE}</td>
      </tr>
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Approvato Da:</td>
        <td style="font-weight: 700; color: #047857;">{APPROVATO_DA}</td>
      </tr>
      <tr>
        <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Data Registrazione:</td>
        <td style="font-weight: 600; color: #64748b;">{DATA_APPROVAZIONE}</td>
      </tr>
    </table>

    <div style="padding: 14px 18px; background-color: #eef2ff; border: 1px solid #c7d2fe; border-radius: 12px; font-size: 12px; color: #3730a3; font-weight: 600;">
      ℹ️ Questa comunicazione è trasmessa automaticamente a tutti i destinatari configurati per il monitoraggio delle presenze nei giorni non lavorativi.
    </div>
  </div>

</div>`,
    placeholders: [
      { code: '{NOME_RISORSA}', label: 'Nome Risorsa', sample: 'Bartalucci Emanuele' },
      { code: '{DATA_FESTIVO}', label: 'Data Festivo / Weekend', sample: 'Domenica 23/08/2026' },
      { code: '{MOTIVAZIONE}', label: 'Motivazione / Attività', sample: 'Attività urgente di collaudo e straordinari cantiere GSK' },
      { code: '{APPROVATO_DA}', label: 'Approvato Da', sample: 'Ufficio Risorse Umane' },
      { code: '{DATA_APPROVAZIONE}', label: 'Data Approvazione', sample: '20/08/2026 ore 14:15' },
    ]
  },
  {
    id: 'presenze_sollecito_modifica_hr',
    label: 'Sollecito / Richiesta Correzione Foglio Presenze da HR',
    category: 'Presenze & Festivi',
    defaultSubject: '[Pianificazione] Correzione richiesta per il tuo Rapportino Presenze - {PERIODO_MESE}',
    defaultBody: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; max-width: 680px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
  
  <!-- Header Amber/Orange Email-Safe con Fallback Outlook -->
  <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#78350f" style="width: 100%; background-color: #78350f; background: linear-gradient(135deg, #78350f 0%, #b45309 50%, #d97706 100%);">
    <tr>
      <td bgcolor="#78350f" style="background-color: #78350f; padding: 26px; color: #ffffff;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width: 100%;">
          <tr>
            <td valign="top" style="vertical-align: top;">
              <div style="font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #fde68a; margin-bottom: 6px;">
                Gestione Presenze & Rapportini
              </div>
              <h1 style="margin: 0; font-size: 22px; font-weight: 900; color: #ffffff; line-height: 1.25;">
                Richiesta Correzione Presenze — {PERIODO_MESE}
              </h1>
              <div style="margin-top: 10px; font-size: 13px; color: #fef3c7; font-weight: 600;">
                👤 Risorsa: <strong style="color: #ffffff;">{NOME_DIPENDENTE}</strong>
              </div>
            </td>
            <td align="right" valign="top" style="text-align: right; vertical-align: top; width: 150px;">
              <span style="background-color: #f59e0b; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
                ⚠️ RICHIESTA MODIFICA
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <div style="padding: 26px;">
    <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 20px; line-height: 1.5; font-weight: 600;">
      Ciao <strong>{NOME_DIPENDENTE}</strong>,<br />
      l'ufficio Risorse Umane / Amministrazione ha esaminato il tuo foglio presenze per il mese di <strong>{PERIODO_MESE}</strong> e richiede alcune verifiche o correzioni.
    </p>

    <h3 style="margin-top: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px; color: #92400e; border-bottom: 2px solid #f59e0b; padding-bottom: 8px; margin-bottom: 16px; font-weight: 900;">
      📝 Note e Indicazioni dell'Ufficio HR
    </h3>

    <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 14px 18px; margin-bottom: 24px; border-radius: 0 12px 12px 0; font-size: 13px; color: #78350f; font-weight: 600; line-height: 1.6;">
      {NOTE_HR}
    </div>

    <p style="font-size: 13px; color: #334155; margin-bottom: 20px; line-height: 1.5;">
      Accedi alla piattaforma di pianificazione aziendale nella sezione <strong>Presenze</strong> per applicare le modifiche richieste e re-inviare il documento.
    </p>
  </div>

</div>`,
    placeholders: [
      { code: '{NOME_DIPENDENTE}', label: 'Nome Risorsa', sample: 'Mancini Marco' },
      { code: '{PERIODO_MESE}', label: 'Mese ed Anno', sample: 'Luglio 2026' },
      { code: '{NOTE_HR}', label: 'Note HR', sample: 'Mancano i rimborsi chilometrici del 12/07.' },
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

export async function getSociNotificationEmails(dipendentiList?: any[]): Promise<string[]> {
  try {
    const docSnap = await getDoc(doc(db, 'configurazioni', 'notifiche_festivi_soci'));
    if (docSnap.exists() && Array.isArray(docSnap.data().emails)) {
      return docSnap.data().emails.map((e: string) => e.toLowerCase().trim()).filter(Boolean);
    }
  } catch (err) {
    console.error("Errore lettura destinatari notifiche festivi:", err);
  }

  // Fallback iniziale ricavato dai dipendenti censiti se la configurazione non esiste ancora
  if (dipendentiList && Array.isArray(dipendentiList) && dipendentiList.length > 0) {
    const found = dipendentiList
      .filter(d => {
        const clean = (d.nome || '').toLowerCase().trim();
        const cleanEmail = (d.email || '').toLowerCase().trim();
        const isSocio = clean.includes('corbellini') || clean.includes('profeti') || d.ruolo === 'Socio' || cleanEmail.includes('corbellini') || cleanEmail.includes('profeti');
        return isSocio && d.email && d.email.trim();
      })
      .map(d => d.email.toLowerCase().trim());
    if (found.length > 0) {
      return Array.from(new Set(found));
    }
  }

  return ['mcorbellini@ingegno06.it', 'aprofeti@ingegno06.it'];
}

export async function saveSociNotificationEmails(emails: string[]): Promise<void> {
  const cleaned = Array.from(new Set(emails.map(e => e.toLowerCase().trim()).filter(Boolean)));
  const docRef = doc(db, 'configurazioni', 'notifiche_festivi_soci');
  await setDoc(docRef, { emails: cleaned, updatedAt: new Date().toISOString() });
}

