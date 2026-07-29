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

          // --- VERSION 1.0.3 ---
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 180 },
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
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Navigazione Diretta ed Interazioni: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Abilitato il click diretto sulle pillole delle risorse assegnate alle commesse dei PM, aprendo direttamente la modale di pianificazione senza passare dal flusso e-mail per le proprie commesse.", color: "374151", font: "Calibri", size: 22 }),
            ],
          }),
          new Paragraph({
            spacing: { before: 60, after: 60 },
            bullet: { level: 0 },
            children: [
              new TextRun({ text: "Griglia Carichi e Filtri: ", bold: true, color: "111827", font: "Calibri", size: 22 }),
              new TextRun({ text: "Risolte le eccezioni di rendering nei campi opzionali delle commesse e migliorato il calcolo delle percentuali d'impegno settimanale.", color: "374151", font: "Calibri", size: 22 }),
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
  const targetDir = path.join(__dirname, 'File Utili');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const targetPath = path.join(targetDir, 'Changelog_Pianificazione_Aziendale.docx');
  fs.writeFileSync(targetPath, buffer);
  console.log('Changelog docx generated successfully at:', targetPath);
}

generateDocx().catch(console.error);
