const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const fs = require('fs');
const path = require('path');

async function generateDocx() {
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
                size: 36,
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
                text: "Registro storico degli aggiornamenti e delle modifiche di versione.",
                italics: true,
                size: 22,
                color: "4B5563",
                font: "Calibri",
              }),
            ],
          }),

          // --- VERSION 1.0.5 ---
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 180 },
            children: [
              new TextRun({
                text: "Versione 1.0.5 — 31/07/2026",
                bold: true,
                size: 28,
                color: "1E3A8A",
                font: "Calibri",
              }),
            ],
          }),
          
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Richiesta Sblocco Foglio Ore / Bozza Fattura (Registro Presenze): ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Aggiunto il pulsante 'Richiedi Sblocco Modifica' con modale per nota motivazionale, visibile al dipendente o collaboratore quando il foglio presenze o la bozza di fattura si trova in stato Inviato o Approvato.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Fix Persistenza Progetti & Utenti da Abilitare (AuthContext): ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Risolto il problema di azzeramento dei progetti al re-open della modifica commessa includendo i campi 'progetti' ed 'apertaDa' nel mapper real-time delle commesse in AuthContext. Ora gli utenti da abilitare selezionati rimangono salvati e visibili a schermo e nelle e-mail di notifica.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Fix Modifica Commesse Storiche / Legacy: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Risolto il problema di mancanza dei campi di compilazione nella modale di modifica per le commesse aperte precedentemente all'introduzione dello split progetti. Ora all'apertura viene generato automaticamente il progetto di default popolato con i dati esistenti (PM, descrizione e giornate stimate) ed aggiunto il pulsante '+ Aggiungi Progetto' con eliminazione riga.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Nuovo Ruolo 'Gestori Commesse' & Layout Ruoli su 2 Righe (Impostazioni & Catalogo): ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Introdotto il ruolo dedicato 'Gestori Commesse' nella scheda Ruoli & Permessi delle Impostazioni. Le risorse a cui viene assegnato questo ruolo acquisiscono i permessi per accedere al Catalogo Commesse e creare o modificare commesse. Riorganizzato il layout della scheda Ruoli su 2 righe ampie e spaziose per evitare il sovraffollamento dei pulsanti di nomina ed i titoli su più righe.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Fix Visualizzazione Testo Card Dashboard: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Risolto il problema di ritaglio della parte inferiore delle lettere (es. 'g' di suggerimenti) nelle card della Dashboard rimuovendo il vincolo rigido di altezza e l'overflow nascosto sui contenitori di descrizione.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Compilazione Libera & Precedenza Modifiche HR: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Abilitata la compilazione senza blocchi per il dipendente su tutte le giornate quando il foglio presenze viene sbloccato (stato Richiede Modifica). Preservata l'integrità delle rettifiche apportate dall'HR evitando sovrascrizioni automatiche dal piano ferie (flag hrModified).", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),

          // --- VERSION 1.0.4 ---
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 360, after: 180 },
            children: [
              new TextRun({
                text: "Versione 1.0.4 — 30/07/2026",
                bold: true,
                size: 28,
                color: "1E3A8A",
                font: "Calibri",
              }),
            ],
          }),
          
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Nuova Pagina Gestionale HR & Benessere (/gestione-hr): ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Realizzata la nuova pagina dedicata accessibile dal pulsante in Dashboard (riservata ad HR e Sviluppatori), perfettamente coordinata nello stile con il resto della piattaforma. Comprende la gestione delle Frasi di Benvenuto della Dashboard, la configurazione ed il tracciamento del Benessere & Stress Lavorativo, la gestione degli Altri Questionari ed il modulo di consultazione/archiviazione dei suggerimenti.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Integrazione Permesso ex L.104 & Deploy Cloudflare: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Impostata la lettera identificativa 'L' per i permessi ex L.104 ed estesa la gestione nei moduli di pianificazione. Risolto definitivamente il deploy Cloudflare rimuovendo il file _redirects in conflitto con il routing SPA nativo ('single-page-application').", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Editor & Simulatore Template E-mail di Sistema: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Integrato nel Tab Sistema delle Impostazioni un Editor avanzato dei modelli e-mail automatizzati con selettore per evento, gestione dei segnaposto dinamici, salvataggio personalizzato su Firestore, anteprima grafica HTML live e invio e-mail di prova.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Riorganizzazione Tab Impostazioni & Fix Cloudflare Deploy: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Impostato il Tab 'Anagrafica Risorse' come primo tab attivo nelle Impostazioni. Aggiunto il file wrangler.jsonc per la risoluzione definitiva del deployment automatizzato su Cloudflare Workers/Pages.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),

          // --- VERSION 1.0.3 ---
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 360, after: 180 },
            children: [
              new TextRun({
                text: "Versione 1.0.3 — 29/07/2026",
                bold: true,
                size: 28,
                color: "1E3A8A",
                font: "Calibri",
              }),
            ],
          }),
          
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Visibilità e Permessi sulle Commesse: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Impostata la regola definitiva per cui Soci, Sviluppatore ed Admin accedono e gestiscono tutte le commesse aperte, mentre Project Manager (PM), Coordinatori e Dipendenti vedono nei menù a tendina ed in griglia solo ed esclusivamente le commesse di cui figurano come PM o Responsabili diretti.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Matching Deterministico Utente-Commessa (areNamesEqual): ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Implementato il confronto basato sul Nome e Cognome completo presente nel database. Risolti i casi di colleghi con lo stesso cognome (es. Rossi Mario vs Rossi Luigi), dello stesso nome di battesimo (Romanello Andrea vs Profeti Andrea) ed ordine invertito (\"Nome Cognome\" vs \"Cognome Nome\").", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Layout ed Allineamento Interfaccia: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Allineato il pulsante '+ Aggiungi Commessa' ed i menu a tendina dell'assegnazione rapida ad un'altezza di 38px con allineamento alla base della riga (sm:items-end). Organizzati i pulsanti di richiesta personale d'area in una griglia 2x2 coordinata.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),

          // --- VERSION 1.0.2 ---
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 360, after: 180 },
            children: [
              new TextRun({
                text: "Versione 1.0.2 — 28/07/2026",
                bold: true,
                size: 28,
                color: "1E3A8A",
                font: "Calibri",
              }),
            ],
          }),

          // PRIORITÀ E COMMESSE
          new Paragraph({
            spacing: { before: 120, after: 60 },
            children: [
              new TextRun({ text: "PRIORITÀ E COMMESSE", bold: true, size: 24, color: "1E1B4B", font: "Calibri" }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Priorità Commesse: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Possibilità per PM, Coordinatori e Admin di impostare la priorità (Alta, Standard, Bassa) per la settimana selezionata.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Banner ed Evidenziatori: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Banner d'avviso in Dashboard per le commesse ad Alta priorità nella settimana corrente e bordo marcato nel calendario.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Vista Risorse Semplici: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Filtraggio automatico sulle sole commesse assegnate, interazione limitata al proprio tassello e invio mail diretto al Coordinatore d'Area cliccando sulla settimana.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Gestione PM: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Restrizione per i PM ad assegnare solo risorse della propria macroarea.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Richiesta Personale: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Allineata la modale in Commesse per consentire la richiesta di risorse specifiche anche appartenenti ad altre aree.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),

          // SEGNALAZIONE DISPONIBILITÀ ("CHIEDI LAVORO")
          new Paragraph({
            spacing: { before: 120, after: 60 },
            children: [
              new TextRun({ text: "SEGNALAZIONE DISPONIBILITÀ (\"CHIEDI LAVORO\")", bold: true, size: 24, color: "1E1B4B", font: "Calibri" }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Nuovo Pulsante e Modale: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Aggiunto pulsante nell'intestazione per dipendenti e collaboratori per segnalare ai coordinatori la propria disponibilità (sia se scarichi, sia se hanno terminato in anticipo i compiti assegnati).", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Notifiche Coordinatori: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Invio email automatico e avviso/badge in rilievo in Dashboard e in Pianificazione Personale per i Coordinatori.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),

          // PIANIFICAZIONE PERSONALE E LAYOUT
          new Paragraph({
            spacing: { before: 120, after: 60 },
            children: [
              new TextRun({ text: "PIANIFICAZIONE PERSONALE E LAYOUT", bold: true, size: 24, color: "1E1B4B", font: "Calibri" }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Sotto-Periodi Granulari: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Raggruppamento delle risorse assegnate in sotto-periodi con la stessa percentuale di carico, modificabili singolarmente con indicazione esatta del range di date e funzione \"Applica % uniforme\".", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Layout Flessibile: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Tabelloni ad altezza adattiva per eliminare gli spazi bianchi vuoti quando si applicano filtri o si mostrano poche righe.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Approvazioni: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Disabilitato il pulsante Approva se la preferenza della risorsa non è valida.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),

          // PRESENZE, FOGLI ORE E TRASFERTE
          new Paragraph({
            spacing: { before: 120, after: 60 },
            children: [
              new TextRun({ text: "PRESENZE, FOGLI ORE E TRASFERTE", bold: true, size: 24, color: "1E1B4B", font: "Calibri" }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Dettaglio Spostamenti e Rimborso Km: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Nuova riga \"Rimborso Km\" e campi dettagliati (Località, Automezzo, Km percorsi) per trasferte e rimborsi con calcolo automatico nei PDF.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Nota Spese Varie: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Integrata direttamente a tutta larghezza sotto il Dettaglio Spostamenti nel foglio ore.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Stampa e Gestione HR: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Stampa in 1-click del singolo foglio ore o bozza fattura; possibilità per l'HR di revocare l'approvazione per consentire modifiche successive.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Formattazione e Sezioni: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Uniformata la formattazione numerica italiana (virgola per i decimali, punto per le migliaia) e riorganizzate le sezioni finali (Certificati e Comunicazioni HR).", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),

          // PIANO FERIE E PERMESSI
          new Paragraph({
            spacing: { before: 120, after: 60 },
            children: [
              new TextRun({ text: "PIANO FERIE E PERMESSI", bold: true, size: 24, color: "1E1B4B", font: "Calibri" }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Collaboratori: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Form limitato alle sole opzioni pertinenti (Assenza, Malattia, Maternità, Smart Working) e catalogazione unica a registro come \"Assenza\".", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Miglioramenti HR: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Smart Working frazionabile (AM/PM/Orario), campo di ricerca per risorsa nel registro e possibilità per l'HR di modificare o annullare direttamente i permessi approvati.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 40, after: 40 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Bugfix: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Corretta la visualizzazione anagrafica dei collaboratori P.IVA nella stampa PDF del registro.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),

          // --- VERSION 1.0.1 ---
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 360, after: 180 },
            children: [
              new TextRun({
                text: "Versione 1.0.1 — 27/07/2026",
                bold: true,
                size: 28,
                color: "1E3A8A",
                font: "Calibri",
              }),
            ],
          }),

          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Modale Unificata Pianificazione: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Introduzione della modale di pianificazione contestuale a tre tab: Gestione per Commessa, Gestione per Risorsa, Sostituzione Risorsa.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Gestione Richieste Risorse tra Aree: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Flusso integrato per la richiesta di personale da altre macro-aree (Disegnatori, Ingegneria, Sicurezza Cantieri, Consulenza Sicurezza, Amministrazione) con invio di notifica al coordinatore di reparto.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Calendario Settimanale e Modalità Modifica: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Implementata la vista carichi settimanali con supporto allo zoom (4-16 settimane) e navigazione temporale rapida.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const targetPath = path.join(__dirname, 'File Utili', 'Changelog_Pianificazione_Aziendale.docx');
  fs.writeFileSync(targetPath, buffer);
  console.log('Changelog docx generated successfully at:', targetPath);
}

generateDocx().catch(console.error);
