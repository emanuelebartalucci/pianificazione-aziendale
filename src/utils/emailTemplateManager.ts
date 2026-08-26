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
    defaultBody: `<!-- Header Dark Navy Email-Safe con Fallback Outlook -->
<table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#0f172a" style="width: 100%; background-color: #0f172a; border-collapse: collapse;">
  <tr>
    <td bgcolor="#0f172a" style="background-color: #0f172a; padding: 22px 24px; color: #ffffff; font-family: Arial, Helvetica, sans-serif;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td valign="top" align="left" style="font-family: Arial, Helvetica, sans-serif;">
            <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px; color: #93c5fd; font-family: Arial, Helvetica, sans-serif;">
              Scheda Apertura Nuova Commessa
            </p>
            <h1 style="margin: 0; font-size: 20px; font-weight: bold; color: #ffffff; line-height: 1.3; font-family: Arial, Helvetica, sans-serif;">
              {CODICE_COMMESSA} — {NOME_COMMESSA}
            </h1>
            <p style="margin: 8px 0 0 0; font-size: 13px; color: #e2e8f0; font-weight: normal; font-family: Arial, Helvetica, sans-serif;">
              Cliente: <strong style="color: #ffffff;">{CLIENTE}</strong>
            </p>
          </td>
          <td align="right" valign="top" width="100" style="text-align: right; vertical-align: top; width: 100px;">
            <table border="0" cellspacing="0" cellpadding="0" align="right" style="border-collapse: collapse;">
              <tr>
                <td bgcolor="#10b981" align="center" style="background-color: #10b981; color: #ffffff; padding: 6px 14px; border-radius: 14px; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, Helvetica, sans-serif;">
                  APERTA
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<!-- Corpo Contenuto 100% Table Based -->
<table width="100%" border="0" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; background-color: #ffffff;">
  <tr>
    <td style="padding: 22px 24px; font-family: Arial, Helvetica, sans-serif; color: #1e293b;">
      
      <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 18px; line-height: 1.5; font-family: Arial, Helvetica, sans-serif;">
        Notifica di apertura nuova commessa sulla piattaforma di pianificazione aziendale con i seguenti dettagli:
      </p>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 12px; border-collapse: collapse;">
        <tr>
          <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #1e1b4b; border-bottom: 2px solid #6366f1; padding-bottom: 6px;">
            Anagrafica Generale & Impostazioni Commessa
          </td>
        </tr>
      </table>

      <table width="100%" border="0" cellpadding="8" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; margin-bottom: 22px; background-color: #ffffff; border: 1px solid #e2e8f0; font-family: Arial, Helvetica, sans-serif;">
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; width: 200px; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Codice Commessa:</td>
          <td style="font-weight: bold; color: #0f172a; font-size: 13px; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">{CODICE_COMMESSA}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Titolo Commessa:</td>
          <td style="font-weight: bold; color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">{NOME_COMMESSA}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Cliente:</td>
          <td style="font-weight: bold; color: #1d4ed8; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">{CLIENTE}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Data Apertura Registrata:</td>
          <td style="font-weight: bold; color: #047857; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">{DATA_APERTURA}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Anno di Riferimento:</td>
          <td style="color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">{ANNO}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Tipologia Commessa:</td>
          <td style="color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">{TIPOLOGIA}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Periodo di Esecuzione:</td>
          <td style="color: #334155; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">Da: <strong>{DATA_INIZIO}</strong> a: <strong>{DATA_FINE}</strong></td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Responsabile Commessa:</td>
          <td style="font-weight: bold; color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">{RESPONSABILE}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Project Manager (PM):</td>
          <td style="font-weight: bold; color: #312e81; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">{PM}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Utenti Abilitati sulla Commessa:</td>
          <td style="font-weight: bold; color: #047857; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">{UTENTI_ABILITATI}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Gestione SGQ / Giornate Stimate:</td>
          <td style="color: #334155; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">{GIORNATE_STIMATE}</td>
        </tr>
        <tr>
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px;">Registrata / Aperta Da:</td>
          <td style="color: #475569; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif;">{APERTA_DA}</td>
        </tr>
      </table>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 12px; border-collapse: collapse;">
        <tr>
          <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #1e1b4b; border-bottom: 2px solid #6366f1; padding-bottom: 6px;">
            Elenco Progetti della Commessa
          </td>
        </tr>
      </table>

      <table width="100%" border="0" cellpadding="14" cellspacing="0" style="width: 100%; border-collapse: collapse; background-color: #ffffff; border: 1px solid #cbd5e1; font-family: Arial, Helvetica, sans-serif; margin-bottom: 8px;">
        <tr>
          <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #0f172a; line-height: 1.6; padding: 14px;">
            {TABELLA_PROGETTI}
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>`,
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
      { code: '{TABELLA_PROGETTI}', label: 'Elenco Nomi Progetti', sample: `<ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #0f172a; line-height: 1.7; font-family: Arial, Helvetica, sans-serif;"><li>Progettazione Esecutiva Impianti Idrici e Termici</li><li>Direzione Lavori & Coordinamento Sicurezza in Cantiere</li></ul>` },
    ]
  },
  {
    id: 'commessa_chiusura',
    label: 'Notifica Chiusura Commessa',
    category: 'Commesse',
    defaultSubject: '[Chiusura Commessa] {CODICE_COMMESSA} - {NOME_COMMESSA}',
    defaultBody: `<!-- Header Dark Red/Navy Email-Safe con Fallback Outlook -->
<table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#0f172a" style="width: 100%; background-color: #0f172a; border-collapse: collapse;">
  <tr>
    <td bgcolor="#0f172a" style="background-color: #0f172a; padding: 22px 24px; color: #ffffff; font-family: Arial, Helvetica, sans-serif;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td valign="top" align="left" style="font-family: Arial, Helvetica, sans-serif;">
            <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px; color: #fecdd3; font-family: Arial, Helvetica, sans-serif;">
              Scheda Chiusura Commessa
            </p>
            <h1 style="margin: 0; font-size: 20px; font-weight: bold; color: #ffffff; line-height: 1.3; font-family: Arial, Helvetica, sans-serif;">
              {CODICE_COMMESSA} — {NOME_COMMESSA}
            </h1>
            <p style="margin: 8px 0 0 0; font-size: 13px; color: #ffe4e6; font-weight: normal; font-family: Arial, Helvetica, sans-serif;">
              Cliente: <strong style="color: #ffffff;">{CLIENTE}</strong>
            </p>
          </td>
          <td align="right" valign="top" width="100" style="text-align: right; vertical-align: top; width: 100px;">
            <table border="0" cellspacing="0" cellpadding="0" align="right" style="border-collapse: collapse;">
              <tr>
                <td bgcolor="#e11d48" align="center" style="background-color: #e11d48; color: #ffffff; padding: 6px 14px; border-radius: 14px; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, Helvetica, sans-serif;">
                  CHIUSA
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<!-- Corpo Contenuto 100% Table Based -->
<table width="100%" border="0" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; background-color: #ffffff;">
  <tr>
    <td style="padding: 22px 24px; font-family: Arial, Helvetica, sans-serif; color: #1e293b;">
      
      <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 18px; line-height: 1.5; font-family: Arial, Helvetica, sans-serif;">
        Notifica di avvenuta chiusura della commessa sulla piattaforma di pianificazione aziendale con i seguenti dettagli:
      </p>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 12px; border-collapse: collapse;">
        <tr>
          <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #881337; border-bottom: 2px solid #f43f5e; padding-bottom: 6px;">
            Anagrafica Generale & Impostazioni Commessa
          </td>
        </tr>
      </table>

      <table width="100%" border="0" cellpadding="8" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; margin-bottom: 22px; background-color: #ffffff; border: 1px solid #fecdd3; font-family: Arial, Helvetica, sans-serif;">
        <tr style="border-bottom: 1px solid #fecdd3;">
          <td width="200" bgcolor="#fff1f2" style="font-weight: bold; width: 200px; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Codice Commessa:</td>
          <td style="font-weight: bold; color: #0f172a; font-size: 13px; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">{CODICE_COMMESSA}</td>
        </tr>
        <tr style="border-bottom: 1px solid #fecdd3;">
          <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Titolo Commessa:</td>
          <td style="font-weight: bold; color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">{NOME_COMMESSA}</td>
        </tr>
        <tr style="border-bottom: 1px solid #fecdd3;">
          <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Cliente:</td>
          <td style="font-weight: bold; color: #1d4ed8; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">{CLIENTE}</td>
        </tr>
        <tr style="border-bottom: 1px solid #fecdd3;">
          <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Data Chiusura Registrata:</td>
          <td style="font-weight: bold; color: #be123c; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">{DATA_CHIUSURA}</td>
        </tr>
        <tr style="border-bottom: 1px solid #fecdd3;">
          <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Anno di Riferimento:</td>
          <td style="color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">{ANNO}</td>
        </tr>
        <tr style="border-bottom: 1px solid #fecdd3;">
          <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Tipologia Commessa:</td>
          <td style="color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">{TIPOLOGIA}</td>
        </tr>
        <tr style="border-bottom: 1px solid #fecdd3;">
          <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Periodo di Esecuzione:</td>
          <td style="color: #334155; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">Da: <strong>{DATA_INIZIO}</strong> a: <strong>{DATA_FINE}</strong></td>
        </tr>
        <tr style="border-bottom: 1px solid #fecdd3;">
          <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Responsabile Commessa:</td>
          <td style="font-weight: bold; color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">{RESPONSABILE}</td>
        </tr>
        <tr style="border-bottom: 1px solid #fecdd3;">
          <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Project Manager (PM):</td>
          <td style="font-weight: bold; color: #312e81; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">{PM}</td>
        </tr>
        <tr style="border-bottom: 1px solid #fecdd3;">
          <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Utenti Abilitati sulla Commessa:</td>
          <td style="font-weight: bold; color: #047857; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">{UTENTI_ABILITATI}</td>
        </tr>
        <tr style="border-bottom: 1px solid #fecdd3;">
          <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #fecdd3;">Gestione SGQ / Giornate Stimate:</td>
          <td style="color: #334155; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #fecdd3;">{GIORNATE_STIMATE}</td>
        </tr>
        <tr>
          <td width="200" bgcolor="#fff1f2" style="font-weight: bold; color: #881337; background-color: #fff1f2; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px;">Registrata / Chiusa Da:</td>
          <td style="font-weight: bold; color: #be123c; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif;">{CHIUSA_DA}</td>
        </tr>
      </table>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 12px; border-collapse: collapse;">
        <tr>
          <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #881337; border-bottom: 2px solid #f43f5e; padding-bottom: 6px;">
            Elenco Progetti della Commessa
          </td>
        </tr>
      </table>

      <table width="100%" border="0" cellpadding="14" cellspacing="0" style="width: 100%; border-collapse: collapse; background-color: #ffffff; border: 1px solid #fecdd3; font-family: Arial, Helvetica, sans-serif; margin-bottom: 16px;">
        <tr>
          <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #0f172a; line-height: 1.6; padding: 14px;">
            {TABELLA_PROGETTI}
          </td>
        </tr>
      </table>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 12px 14px; background-color: #fef2f2; border: 1px solid #fecdd3; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #9f1239;">
            Nota: Le eventuali assegnazioni di ore pianificate per questa commessa nelle settimane successive alla chiusura sono state automaticamente rimosse.
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>`,
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
      { code: '{TABELLA_PROGETTI}', label: 'Elenco Nomi Progetti', sample: `<ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #0f172a; line-height: 1.7; font-family: Arial, Helvetica, sans-serif;"><li>Progettazione Esecutiva Impianti Idrici e Termici</li><li>Direzione Lavori & Coordinamento Sicurezza in Cantiere</li></ul>` },
    ]
  },
  {
    id: 'approvazione_lavoro_festivo',
    label: 'Notifica Approvazione Lavoro Weekend e Festivi',
    category: 'Presenze & Festivi',
    defaultSubject: '[Lavoro Festivo Approvato] {NOME_RISORSA} - {DATA_FESTIVO}',
    defaultBody: `<!-- Header Dark Navy Email-Safe con Fallback Outlook -->
<table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#0f172a" style="width: 100%; background-color: #0f172a; border-collapse: collapse;">
  <tr>
    <td bgcolor="#0f172a" style="background-color: #0f172a; padding: 22px 24px; color: #ffffff; font-family: Arial, Helvetica, sans-serif;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td valign="top" align="left" style="font-family: Arial, Helvetica, sans-serif;">
            <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px; color: #a5b4fc; font-family: Arial, Helvetica, sans-serif;">
              Autorizzazione Lavoro Straordinario / Festivo
            </p>
            <h1 style="margin: 0; font-size: 20px; font-weight: bold; color: #ffffff; line-height: 1.3; font-family: Arial, Helvetica, sans-serif;">
              {NOME_RISORSA} — {DATA_FESTIVO}
            </h1>
            <p style="margin: 8px 0 0 0; font-size: 13px; color: #e0e7ff; font-family: Arial, Helvetica, sans-serif;">
              Approvato per lavoro nel weekend / festività
            </p>
          </td>
          <td align="right" valign="top" width="120" style="text-align: right; vertical-align: top; width: 120px;">
            <table border="0" cellspacing="0" cellpadding="0" align="right" style="border-collapse: collapse;">
              <tr>
                <td bgcolor="#10b981" align="center" style="background-color: #10b981; color: #ffffff; padding: 6px 14px; border-radius: 14px; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, Helvetica, sans-serif;">
                  AUTORIZZATO
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<!-- Corpo Contenuto 100% Table Based -->
<table width="100%" border="0" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; background-color: #ffffff;">
  <tr>
    <td style="padding: 22px 24px; font-family: Arial, Helvetica, sans-serif; color: #1e293b;">
      <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 18px; line-height: 1.5; font-family: Arial, Helvetica, sans-serif;">
        Notifica automatica per i <strong>Soci</strong>: è stata approvata una richiesta di autorizzazione per lo svolgimento di attività lavorativa in giornata festiva o durante il fine settimana.
      </p>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 12px; border-collapse: collapse;">
        <tr>
          <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #1e1b4b; border-bottom: 2px solid #6366f1; padding-bottom: 6px;">
            Dettaglio Autorizzazione Lavoro Festivo
          </td>
        </tr>
      </table>

      <table width="100%" border="0" cellpadding="8" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; margin-bottom: 22px; background-color: #ffffff; border: 1px solid #e2e8f0; font-family: Arial, Helvetica, sans-serif;">
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; width: 200px; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Risorsa Autorizzata:</td>
          <td style="font-weight: bold; color: #0f172a; font-size: 13px; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">{NOME_RISORSA}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Data / Giorno Festivo:</td>
          <td style="font-weight: bold; color: #4338ca; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">{DATA_FESTIVO}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Motivazione / Attività:</td>
          <td style="color: #0f172a; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">{MOTIVAZIONE}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; border-bottom: 1px solid #e2e8f0;">Approvato Da:</td>
          <td style="font-weight: bold; color: #047857; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; border-bottom: 1px solid #e2e8f0;">{APPROVATO_DA}</td>
        </tr>
        <tr>
          <td width="200" bgcolor="#f8fafc" style="font-weight: bold; color: #475569; background-color: #f8fafc; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif; font-size: 12px;">Data Registrazione:</td>
          <td style="color: #475569; padding: 9px 12px; font-family: Arial, Helvetica, sans-serif;">{DATA_APPROVAZIONE}</td>
        </tr>
      </table>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 12px 14px; background-color: #eef2ff; border: 1px solid #c7d2fe; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #3730a3;">
            Questa comunicazione è trasmessa automaticamente a tutti i Soci in conformità alle direttive aziendali per il monitoraggio delle presenze nei giorni non lavorativi.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
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
    defaultBody: `<!-- Header Amber/Orange Email-Safe con Fallback Outlook -->
<table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#78350f" style="width: 100%; background-color: #78350f; border-collapse: collapse;">
  <tr>
    <td bgcolor="#78350f" style="background-color: #78350f; padding: 22px 24px; color: #ffffff; font-family: Arial, Helvetica, sans-serif;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td valign="top" align="left" style="font-family: Arial, Helvetica, sans-serif;">
            <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px; color: #fde68a; font-family: Arial, Helvetica, sans-serif;">
              Gestione Presenze & Rapportini
            </p>
            <h1 style="margin: 0; font-size: 20px; font-weight: bold; color: #ffffff; line-height: 1.3; font-family: Arial, Helvetica, sans-serif;">
              Richiesta Correzione Presenze — {PERIODO_MESE}
            </h1>
            <p style="margin: 8px 0 0 0; font-size: 13px; color: #fef3c7; font-family: Arial, Helvetica, sans-serif;">
              Risorsa: <strong style="color: #ffffff;">{NOME_DIPENDENTE}</strong>
            </p>
          </td>
          <td align="right" valign="top" width="130" style="text-align: right; vertical-align: top; width: 130px;">
            <table border="0" cellspacing="0" cellpadding="0" align="right" style="border-collapse: collapse;">
              <tr>
                <td bgcolor="#f59e0b" align="center" style="background-color: #f59e0b; color: #ffffff; padding: 6px 14px; border-radius: 14px; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; font-family: Arial, Helvetica, sans-serif;">
                  MODIFICA
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<!-- Corpo Contenuto 100% Table Based -->
<table width="100%" border="0" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; background-color: #ffffff;">
  <tr>
    <td style="padding: 22px 24px; font-family: Arial, Helvetica, sans-serif; color: #1e293b;">
      <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 18px; line-height: 1.5; font-family: Arial, Helvetica, sans-serif;">
        Ciao <strong>{NOME_DIPENDENTE}</strong>,<br />
        l'ufficio Risorse Umane / Amministrazione ha esaminato il tuo foglio presenze per il mese di <strong>{PERIODO_MESE}</strong> e richiede alcune verifiche o correzioni.
      </p>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 12px; border-collapse: collapse;">
        <tr>
          <td style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #92400e; border-bottom: 2px solid #f59e0b; padding-bottom: 6px;">
            Note e Indicazioni dell'Ufficio HR
          </td>
        </tr>
      </table>

      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 20px; border-collapse: collapse;">
        <tr>
          <td style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #78350f; line-height: 1.6;">
            {NOTE_HR}
          </td>
        </tr>
      </table>

      <p style="font-size: 13px; color: #334155; margin-bottom: 10px; line-height: 1.5; font-family: Arial, Helvetica, sans-serif;">
        Accedi alla piattaforma di pianificazione aziendale nella sezione <strong>Presenze</strong> per applicare le modifiche richieste e re-inviare il documento.
      </p>
    </td>
  </tr>
</table>`,
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

