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
    defaultSubject: '[Nuova Commessa] Aperta commessa: {NOME_COMMESSA}',
    defaultBody: `<p>Gentili,</p>
<p>Ti informiamo che è stata aperta una nuova commessa sulla piattaforma di pianificazione con i seguenti dettagli:</p>
<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 15px 0;" />
<table border="0" cellpadding="5" cellspacing="0" style="font-size: 14px; color: #374151; width: 100%;">
  <tr><td style="font-weight: bold; width: 180px;">Codice Commessa:</td><td>{CODICE_COMMESSA}</td></tr>
  <tr><td style="font-weight: bold;">Titolo:</td><td>{NOME_COMMESSA}</td></tr>
  <tr><td style="font-weight: bold;">Cliente:</td><td>{CLIENTE}</td></tr>
  <tr><td style="font-weight: bold;">Aperta da:</td><td><strong style="color: #047857;">{APERTA_DA}</strong></td></tr>
  <tr><td style="font-weight: bold;">Responsabile Commessa:</td><td>{RESPONSABILE}</td></tr>
</table>
<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;" />
<p>Puoi ora procedere all'apertura di questa commessa sul gestionale aziendale.</p>`,
    placeholders: [
      { code: '{CODICE_COMMESSA}', label: 'Codice Commessa', sample: '2026-042' },
      { code: '{NOME_COMMESSA}', label: 'Nome Commessa', sample: 'Progettazione Impianti Idrici' },
      { code: '{CLIENTE}', label: 'Cliente', sample: 'Acque S.p.A.' },
      { code: '{APERTA_DA}', label: 'Operatore Apertura', sample: 'Bartalucci Emanuele' },
      { code: '{RESPONSABILE}', label: 'Responsabile Commessa', sample: 'Profeti Andrea' },
    ]
  },
  {
    id: 'commessa_chiusura',
    label: 'Notifica Chiusura Commessa',
    category: 'Commesse',
    defaultSubject: '[Notifica Chiusura] Chiusa commessa: {CODICE_COMMESSA} - {NOME_COMMESSA}',
    defaultBody: `<p>Gentili,</p>
<p>Ti informiamo che la seguente commessa è stata <strong>CONTRASSEGNATA COME CHIUSA</strong> sulla piattaforma di pianificazione:</p>
<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 15px 0;" />
<table border="0" cellpadding="5" cellspacing="0" style="font-size: 14px; color: #374151; width: 100%;">
  <tr><td style="font-weight: bold; width: 180px;">Codice Commessa:</td><td>{CODICE_COMMESSA}</td></tr>
  <tr><td style="font-weight: bold;">Titolo / Nome:</td><td>{NOME_COMMESSA}</td></tr>
  <tr><td style="font-weight: bold;">Chiusa da:</td><td><strong style="color: #b91c1c;">{CHIUSA_DA}</strong></td></tr>
</table>
<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
<p style="font-size: 12px; color: #6b7280;">Nota: Le eventuali assegnazioni di ore pianificate per questa commessa nelle settimane successive a oggi sono state automaticamente rimosse.</p>`,
    placeholders: [
      { code: '{CODICE_COMMESSA}', label: 'Codice Commessa', sample: '2026-042' },
      { code: '{NOME_COMMESSA}', label: 'Nome Commessa', sample: 'Progettazione Impianti Idrici' },
      { code: '{CHIUSA_DA}', label: 'Operatore Chiusura', sample: 'Bartalucci Emanuele' },
    ]
  },
  {
    id: 'commessa_assegnazione',
    label: 'Notifica Assegnazione PM / Responsabile',
    category: 'Commesse',
    defaultSubject: '[Notifica] Assegnazione Ruolo su Commessa {NOME_COMMESSA}',
    defaultBody: `<p>Ciao <strong>{NOME_DIPENDENTE}</strong>,</p>
<p>Sei stato assegnato come <strong>{RUOLO_COMMESSA}</strong> per la commessa <strong>{NOME_COMMESSA}</strong>.</p>
<p>Periodo previsto: dal <strong>{DATA_INIZIO}</strong> al <strong>{DATA_FINE}</strong>.</p>
<p>Puoi procedere alla pianificazione ed al monitoraggio delle risorse per questa commessa dall'applicazione.</p>`,
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
    label: 'Notifica Assegnazione Ferie / Assenza (da HR)',
    category: 'Ferie & Assenze',
    defaultSubject: "[Notifica] Assegnazione {TIPO_ASSENZA} da parte dell'HR",
    defaultBody: `<p>Ciao <strong>{NOME_DIPENDENTE}</strong>,</p>
<p>Ti informiamo che l'amministrazione / HR ha inserito a tuo nome la seguente assenza: <strong>{TIPO_ASSENZA}</strong> prevista <strong>{PERIODO_ASSENZA}</strong>.</p>
<p>Il tuo calendario e il registro presenze sono stati aggiornati di conseguenza.</p>`,
    placeholders: [
      { code: '{NOME_DIPENDENTE}', label: 'Nome Risorsa', sample: 'Bartalucci Emanuele' },
      { code: '{TIPO_ASSENZA}', label: 'Tipo Assenza', sample: 'Ferie' },
      { code: '{PERIODO_ASSENZA}', label: 'Periodo / Orario', sample: 'dal 20/08/2026 al 21/08/2026' },
    ]
  },
  {
    id: 'ferie_annullamento_hr',
    label: 'Notifica Annullamento Ferie / Assenza (da HR)',
    category: 'Ferie & Assenze',
    defaultSubject: '[Notifica] Annullamento richiesta {TIPO_ASSENZA}',
    defaultBody: `<p>Ciao <strong>{NOME_DIPENDENTE}</strong>,</p>
<p>Ti informiamo che la tua richiesta di <strong>{TIPO_ASSENZA}</strong> prevista <strong>{PERIODO_ASSENZA}</strong> (in stato <em>{STATO_PRECEDENTE}</em>) è stata <strong>annullata dall'amministrazione / HR</strong>.</p>
{MOTIVAZIONE_HTML}
<p>Il calendario e il registro presenze sono stati aggiornati di conseguenza.</p>`,
    placeholders: [
      { code: '{NOME_DIPENDENTE}', label: 'Nome Risorsa', sample: 'Bartalucci Emanuele' },
      { code: '{TIPO_ASSENZA}', label: 'Tipo Assenza', sample: 'Ferie' },
      { code: '{PERIODO_ASSENZA}', label: 'Periodo / Orario', sample: 'dal 20/08/2026 al 21/08/2026' },
      { code: '{STATO_PRECEDENTE}', label: 'Stato Precedente', sample: 'approvato' },
      { code: '{MOTIVAZIONE_HTML}', label: 'Motivazione Annullamento', sample: "<p><strong>Motivazione dell'annullamento:</strong> Spostamento esigenze di cantiere</p>" },
    ]
  },
  {
    id: 'ferie_decisione',
    label: 'Notifica Approvazione / Rifiuto Richiesta Ferie',
    category: 'Ferie & Assenze',
    defaultSubject: '[Notifica] Richiesta {TIPO_ASSENZA} {ESITO_DECISIONE}',
    defaultBody: `<p>Ciao <strong>{NOME_DIPENDENTE}</strong>,</p>
<p>La tua richiesta di <strong>{TIPO_ASSENZA}</strong> prevista <strong>{PERIODO_ASSENZA}</strong> è stata <strong>{ESITO_DECISIONE}</strong>.</p>
<p>Puoi consultare lo stato delle tue richieste direttamente nella tua area personale della webapp.</p>`,
    placeholders: [
      { code: '{NOME_DIPENDENTE}', label: 'Nome Risorsa', sample: 'Biagioni Matteo' },
      { code: '{TIPO_ASSENZA}', label: 'Tipo Assenza', sample: 'Permesso' },
      { code: '{PERIODO_ASSENZA}', label: 'Periodo / Orario', sample: 'il 14/08/2026 (pomeriggio)' },
      { code: '{ESITO_DECISIONE}', label: 'Esito (approvata/rifiutata)', sample: 'approvata' },
    ]
  },
  {
    id: 'weekend_decisione',
    label: 'Notifica Autorizzazione Lavoro Festivo',
    category: 'Ferie & Assenze',
    defaultSubject: '[Notifica] Autorizzazione lavoro festivo {ESITO_FESTIVO}',
    defaultBody: `<p>Ciao <strong>{NOME_DIPENDENTE}</strong>,</p>
<p>La tua richiesta di autorizzazione per il lavoro festivo del giorno <strong>{DATA_FESTIVO}</strong> ({MOTIVAZIONE}) è stata <strong>{ESITO_FESTIVO}</strong>.</p>
{INFO_PRESENZE_HTML}`,
    placeholders: [
      { code: '{NOME_DIPENDENTE}', label: 'Nome Risorsa', sample: 'Cappelli Marco' },
      { code: '{DATA_FESTIVO}', label: 'Data Festivo/Weekend', sample: '15/08/2026' },
      { code: '{MOTIVAZIONE}', label: 'Motivazione', sample: 'Intervento programmato in centrale' },
      { code: '{ESITO_FESTIVO}', label: 'Esito (approvata/rifiutata)', sample: 'approvata' },
      { code: '{INFO_PRESENZE_HTML}', label: 'Indicazione Foglio Presenze', sample: "<p>Puoi procedere all'inserimento delle ore sul tuo foglio presenze.</p>" },
    ]
  },
  {
    id: 'presenze_sollecito',
    label: 'Notifica Sollecito / Correzione Rapportino Presenze',
    category: 'Presenze',
    defaultSubject: '[Presenze] Richiesta Modifiche Rapportino {PERIODO_MESE}',
    defaultBody: `<p>Ciao <strong>{NOME_DIPENDENTE}</strong>,</p>
<p>L'amministrazione / HR ha richiesto delle verifiche o correzioni sul tuo rapportino presenze per il mese di <strong>{PERIODO_MESE}</strong>.</p>
{NOTE_HR_HTML}
<p>Accedi alla sezione Presenze dell'applicazione per aggiornare i dati e re-inviare il rapportino.</p>`,
    placeholders: [
      { code: '{NOME_DIPENDENTE}', label: 'Nome Risorsa', sample: 'Mancini Marco' },
      { code: '{PERIODO_MESE}', label: 'Mese ed Anno', sample: 'Luglio 2026' },
      { code: '{NOTE_HR_HTML}', label: 'Comunicazioni dall\'HR', sample: "<p><strong>Note HR:</strong> Mancano i rimborsi chilometrici del 12/07.</p>" },
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
