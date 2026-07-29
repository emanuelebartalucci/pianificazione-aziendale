const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const fs = require('fs');
const path = require('path');

async function generateDocx() {
  const createCategoryHeading = (text) => new Paragraph({
    spacing: { before: 180, after: 60 },
    children: [
      new TextRun({
        text: text,
        bold: true,
        size: 24, // 12pt
        color: "1F2937", // Gray 800
        font: "Calibri",
      }),
    ],
  });

  const createBullet = (boldTitle, text) => new Paragraph({
    spacing: { before: 40, after: 40 },
    bullet: { level: 0 },
    children: [
      new TextRun({ text: boldTitle + ": ", bold: true, color: "111827", font: "Calibri", size: 22 }),
      new TextRun({ text: text, color: "374151", font: "Calibri", size: 22 }),
    ],
  });

  const createSubBullet = (boldTitle, text) => new Paragraph({
    spacing: { before: 30, after: 30 },
    bullet: { level: 1 },
    children: [
      new TextRun({ text: boldTitle + ": ", bold: true, color: "1F2937", font: "Calibri", size: 21 }),
      new TextRun({ text: text, color: "4B5563", font: "Calibri", size: 21 }),
    ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children: [
          // Title
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: "Changelog — Pianificazione Aziendale",
                bold: true,
                size: 36, // 18pt
                color: "1E1B4B",
                font: "Calibri",
              }),
            ],
          }),
          // Subtitle
          new Paragraph({
            spacing: { after: 360 },
            children: [
              new TextRun({
                text: "Registro storico dettagliato degli aggiornamenti, delle nuove funzionalità e delle modifiche di versione.",
                italics: true,
                size: 22,
                color: "4B5563",
                font: "Calibri",
              }),
            ],
          }),

          // ==================== VERSION 1.0.3 ====================
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 120 },
            children: [
              new TextRun({
                text: "CHANGELOG v1.0.3 (29/07/2026)",
                bold: true,
                size: 28, // 14pt
                color: "1E3A8A",
                font: "Calibri",
              }),
            ],
          }),

          createCategoryHeading("VISIBILITÀ E PERMESSI RIGOROSI SULLE COMMESSE"),
          createBullet("Regola Definitiva della Visibilità", "Impostata la regola rigorosa per cui Soci, Sviluppatore ed Admin accedono e gestiscono tutte le commesse aziendali aperte nei menù a tendina, nella griglia carichi e nelle modali."),
          createBullet("Project Manager e Coordinatori", "I PM, i Coordinatori d'Area ed i Dipendenti vedono nei menù a tendina ed in griglia SOLO ED ESCLUSIVAMENTE le proprie commesse di cui figurano espressamente come PM o Responsabili diretti."),
          createBullet("Matching Deterministico Utente-Commessa (areNamesEqual)", "Implementato il confronto basato sul Nome e Cognome completo presente nel database. Risolti ed isolati con precisione al 100% i casi di colleghi con lo stesso cognome (es. Rossi Mario vs Rossi Luigi), dello stesso nome di battesimo (Romanello Andrea vs Profeti Andrea) ed ordine invertito (\"Nome Cognome\" vs \"Cognome Nome\")."),

          createCategoryHeading("LAYOUT, ALLINEAMENTI ED INTERFACCIA"),
          createBullet("Assegnazione Rapida Commessa", "Allineati con precisione millimetrica il pulsante '+ Aggiungi Commessa' ed i menu a tendina dell'assegnazione rapida ad un'altezza di 38px con allineamento alla base della riga (sm:items-end)."),
          createBullet("Pulsanti Richiesta Personale d'Area", "Riorganizzati i pulsanti per la richiesta di risorse da altre macro-aree in una griglia 2x2 coordinata."),

          createCategoryHeading("CORREZIONI E STABILIZZAZIONE HOOK"),
          createBullet("Temporal Dead Zone & Inizializzazioni", "Risolte le eccezioni di rendering (ReferenceError) riordinando i memo e gli stati in ordine topologico di dipendenza sequenziale."),

          // ==================== VERSION 1.0.2 ====================
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 360, after: 120 },
            children: [
              new TextRun({
                text: "CHANGELOG v1.0.2 (28/07/2026)",
                bold: true,
                size: 28,
                color: "1E3A8A",
                font: "Calibri",
              }),
            ],
          }),

          createCategoryHeading("PRIORITÀ E COMMESSE"),
          createBullet("Priorità Commesse", "Possibilità per PM, Coordinatori e Admin di impostare la priorità (Alta, Standard, Bassa) per la settimana selezionata."),
          createBullet("Banner ed Evidenziatori", "Banner d'avviso in Dashboard per le commesse ad Alta priorità nella settimana corrente e bordo marcato nel calendario."),
          createBullet("Vista Risorse Semplici", "Filtraggio automatico sulle sole commesse assegnate, interazione limitata al proprio tassello e invio mail diretto al Coordinatore d'Area cliccando sulla settimana."),
          createBullet("Gestione PM", "Restrizione per i PM ad assegnare solo risorse della propria macroarea."),
          createBullet("Assegnazioni Dirette", "Abilitato il click diretto sulle pillole delle risorse assegnate alle commesse dei PM per aprire la modale di pianificazione senza passare dal flusso e-mail per le proprie commesse."),
          createBullet("Richiesta Personale", "Allineata la modale in Commesse per consentire la richiesta di risorse specifiche anche appartenenti ad altre aree."),

          createCategoryHeading("SEGNALAZIONE DISPONIBILITÀ (\"CHIEDI LAVORO\")"),
          createBullet("Nuovo Pulsante e Modale", "Aggiunto pulsante nell'intestazione per dipendenti e collaboratori per segnalare ai coordinatori la propria disponibilità (sia se scarichi, sia se hanno terminato in anticipo i compiti assegnati)."),
          createBullet("Notifiche Coordinatori", "Invio email automatico e avviso/badge in rilievo in Dashboard e in Pianificazione Personale per i Coordinatori."),

          createCategoryHeading("PIANIFICAZIONE PERSONALE E LAYOUT"),
          createBullet("Sotto-Periodi Granulari", "Raggruppamento delle risorse assegnate in sotto-periodi con la stessa percentuale di carico, modificabili singolarmente con indicazione esatta del range di date e funzione 'Applica % uniforme'."),
          createBullet("Layout Flessibile", "Tabelloni ad altezza adattiva per eliminare gli spazi bianchi vuoti quando si applicano filtri o si mostrano poche righe."),
          createBullet("Approvazioni", "Disabilitato il pulsante Approva se la preferenza della risorsa non è valida."),

          createCategoryHeading("PRESENZE, FOGLI ORE E TRASFERTE"),
          createBullet("Dettaglio Spostamenti e Rimborso Km", "Nuova riga 'Rimborso Km' e campi dettagliati (Località, Automezzo, Km percorsi) per trasferte e rimborsi con calcolo automatico nei PDF."),
          createBullet("Nota Spese Varie", "Integrata direttamente a tutta larghezza sotto il Dettaglio Spostamenti nel foglio ore."),
          createBullet("Stampa e Gestione HR", "Stampa in 1-click del singolo foglio ore o bozza fattura; possibilità per l'HR di revocare l'approvazione per consentire modifiche successive."),
          createBullet("Formattazione e Sezioni", "Uniformata la formattazione numerica italiana (virgola per i decimali, punto per le migliaia) e riorganizzate le sezioni finali (Certificati e Comunicazioni HR)."),

          createCategoryHeading("PIANO FERIE E PERMESSI"),
          createBullet("Collaboratori", "Form limitato alle sole opzioni pertinenti (Assenza, Malattia, Maternità, Smart Working) e catalogazione unica a registro come 'Assenza'."),
          createBullet("Miglioramenti HR", "Smart Working frazionabile (AM/PM/Orario), campo di ricerca per risorsa nel registro e possibilità per l'HR di modificare o annullare direttamente i permessi approvati."),
          createBullet("Bugfix", "Corretta la visualizzazione anagrafica dei collaboratori P.IVA nella stampa PDF del registro."),

          // ==================== VERSION 1.0.1 ====================
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 360, after: 120 },
            children: [
              new TextRun({
                text: "CHANGELOG v1.0.1 (27/07/2026)",
                bold: true,
                size: 28,
                color: "1E3A8A",
                font: "Calibri",
              }),
            ],
          }),

          createCategoryHeading("MODALE UNIFICATA PIANIFICAZIONE"),
          createBullet("Pianificazione Contestuale a 3 Tab", "Introduzione della modale di pianificazione contestuale a tre tab: Gestione per Commessa, Gestione per Risorsa, Sostituzione Risorsa."),
          createBullet("Gestione Assegnazioni Settimanali", "Selezione rapida del periodo (settimana o intervallo di settimane) con aggiornamento in tempo reale della disponibilità e dei carichi percentuali."),

          createCategoryHeading("GESTIONE RICHIESTE RISORSE TRA AREE"),
          createBullet("Flusso Richiesta Coordinatori", "Sistema integrato per la richiesta di personale appartenente ad altre macro-aree (Disegnatori, Ingegneria, Sicurezza Cantieri, Consulenza Sicurezza, Amministrazione)."),
          createBullet("Notifiche ed Email Automatiche", "Invio immediato della notifica e della mail al coordinatore d'area interessato con i dettagli dell'impegno richiesto."),

          createCategoryHeading("CALENDARIO CARICHI E VISTA TIMELINE"),
          createBullet("Vista Carichi Settimanali", "Tabellone interattivo dei carichi di lavoro con supporto allo zoom dinamico (da 4 a 16 settimane)."),
          createBullet("Indicatori Visivi e Saturazione", "Evidenziazione cromatica dello stato di saturazione (sotto-carico, carico ottimale, sovraccarico) e contrassegni delle commesse bloccate o in corso."),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const targetDir = path.join(__dirname, 'File Utili');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const targetPath = path.join(targetDir, 'Changelog_Pianificazione_Aziendale.docx');
  fs.writeFileSync(targetPath, buffer);
  console.log('Changelog docx updated with full details at:', targetPath);
}

generateDocx().catch(console.error);
