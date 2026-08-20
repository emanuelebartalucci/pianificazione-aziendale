const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const fs = require('fs');
const path = require('path');

async function generateDocx() {
  const mdPath = path.join(__dirname, 'File Utili', 'Changelog_Pianificazione_Aziendale.md');
  const mdContent = fs.readFileSync(mdPath, 'utf8');

  const lines = mdContent.split('\n');
  const children = [];

  // Extract metadata if available
  let docTitle = "Changelog e Storico Aggiornamenti — Pianificazione Aziendale";
  let docSubtitle = "Registro storico degli aggiornamenti e delle modifiche di versione.";

  // Title section
  children.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: docTitle,
          bold: true,
          size: 36, // 18pt
          color: "1E1B4B",
          font: "Calibri",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 360 },
      children: [
        new TextRun({
          text: docSubtitle,
          italics: true,
          size: 22, // 11pt
          color: "4B5563",
          font: "Calibri",
        }),
      ],
    })
  );

  function formatTextRuns(text) {
    const runs = [];
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
    for (const part of parts) {
      if (part.startsWith('**') && part.endsWith('**')) {
        runs.push(
          new TextRun({
            text: part.slice(2, -2),
            bold: true,
            color: "111827",
            font: "Calibri",
            size: 22,
          })
        );
      } else if (part.startsWith('*') && part.endsWith('*')) {
        runs.push(
          new TextRun({
            text: part.slice(1, -1),
            italics: true,
            color: "374151",
            font: "Calibri",
            size: 22,
          })
        );
      } else if (part.startsWith('`') && part.endsWith('`')) {
        runs.push(
          new TextRun({
            text: part.slice(1, -1),
            bold: true,
            color: "1E3A8A",
            font: "Consolas",
            size: 20,
          })
        );
      } else if (part) {
        runs.push(
          new TextRun({
            text: part,
            color: "374151",
            font: "Calibri",
            size: 22,
          })
        );
      }
    }
    return runs;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rawLine = line.trim();

    if (!rawLine || rawLine.startsWith('---') || rawLine.startsWith('title:') || rawLine.startsWith('subtitle:') || rawLine.startsWith('date:') || rawLine.startsWith('lang:') || rawLine.startsWith('![')) {
      continue;
    }

    if (rawLine.startsWith('# ')) {
      // H1 already handled in header, skip or format
      continue;
    } else if (rawLine.startsWith('## ')) {
      const headingText = rawLine.replace('## ', '').trim();
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 320, after: 120 },
          children: [
            new TextRun({
              text: headingText,
              bold: true,
              size: 28, // 14pt
              color: "1E3A8A",
              font: "Calibri",
            }),
          ],
        })
      );
    } else if (rawLine.startsWith('### ')) {
      const headingText = rawLine.replace('### ', '').trim();
      children.push(
        new Paragraph({
          spacing: { before: 160, after: 80 },
          children: [
            new TextRun({
              text: headingText,
              bold: true,
              size: 24, // 12pt
              color: "1E1B4B",
              font: "Calibri",
            }),
          ],
        })
      );
    } else if (line.startsWith('    - ') || line.startsWith('  - ') || line.startsWith('\t- ')) {
      // Sub bullet
      const itemText = rawLine.replace(/^[-*]\s/, '').trim();
      children.push(
        new Paragraph({
          spacing: { before: 30, after: 30 },
          indent: { left: 480 },
          bullet: { level: 1 },
          children: formatTextRuns(itemText),
        })
      );
    } else if (rawLine.startsWith('- ') || rawLine.startsWith('* ')) {
      // Top level bullet
      const itemText = rawLine.replace(/^[-*]\s/, '').trim();
      children.push(
        new Paragraph({
          spacing: { before: 40, after: 40 },
          bullet: { level: 0 },
          children: formatTextRuns(itemText),
        })
      );
    } else if (rawLine.startsWith('---')) {
      // Divider
      continue;
    } else {
      // Normal paragraph
      children.push(
        new Paragraph({
          spacing: { before: 60, after: 60 },
          children: formatTextRuns(rawLine),
        })
      );
    }
  }

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
        children: children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const targetPath = path.join(__dirname, 'File Utili', 'Changelog_Pianificazione_Aziendale.docx');
  try {
    fs.writeFileSync(targetPath, buffer);
    console.log('Changelog docx generated successfully at:', targetPath);
  } catch (err) {
    if (err.code === 'EBUSY') {
      console.warn('Avviso: Changelog_Pianificazione_Aziendale.docx è aperto in un altro programma (es. Word). Il file verrà aggiornato alla chiusura del programma.');
    } else {
      throw err;
    }
  }
}

generateDocx().catch(console.error);
