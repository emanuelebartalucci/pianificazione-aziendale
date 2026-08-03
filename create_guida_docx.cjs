const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const fs = require('fs');
const path = require('path');

async function generateGuidaDocx() {
  const mdPath = path.join(__dirname, 'File Utili', 'Guida Web App.md');
  const mdContent = fs.readFileSync(mdPath, 'utf8');

  const lines = mdContent.split('\n');
  const children = [];

  // Title section
  children.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: "Manuale Operativo della Web App",
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
          text: "Pianificazione e Gestione Aziendale — Versione 1.0.6 (Agosto 2026)",
          italics: true,
          size: 22, // 11pt
          color: "4B5563",
          font: "Calibri",
        }),
      ],
    })
  );

  let currentHeading1 = '';

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('---') || rawLine.startsWith('title:') || rawLine.startsWith('subtitle:') || rawLine.startsWith('date:') || rawLine.startsWith('lang:') || rawLine.startsWith('![')) {
      continue;
    }

    if (rawLine.startsWith('# ')) {
      const headingText = rawLine.replace('# ', '').trim();
      currentHeading1 = headingText;
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 360, after: 120 },
          children: [
            new TextRun({
              text: headingText,
              bold: true,
              size: 30, // 15pt
              color: "1E3A8A",
              font: "Calibri",
            }),
          ],
        })
      );
    } else if (rawLine.startsWith('## ')) {
      const headingText = rawLine.replace('## ', '').trim();
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 80 },
          children: [
            new TextRun({
              text: headingText,
              bold: true,
              size: 26, // 13pt
              color: "1F2937",
              font: "Calibri",
            }),
          ],
        })
      );
    } else if (rawLine.match(/^\d+\.\s/)) {
      // Numbered list item
      const itemText = rawLine.replace(/^\d+\.\s/, '').trim();
      children.push(
        new Paragraph({
          spacing: { before: 40, after: 40 },
          indent: { left: 360 },
          children: formatTextRuns(itemText),
        })
      );
    } else if (rawLine.startsWith('- ') || rawLine.startsWith('* ')) {
      // Bullet list item
      const itemText = rawLine.replace(/^[-*]\s/, '').trim();
      children.push(
        new Paragraph({
          spacing: { before: 30, after: 30 },
          bullet: { level: 1 },
          children: formatTextRuns(itemText),
        })
      );
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

  function formatTextRuns(text) {
    const runs = [];
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);
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
  const targetPath = path.join(__dirname, 'File Utili', 'Guida Web App.docx');
  try {
    fs.writeFileSync(targetPath, buffer);
    console.log('Guida Web App docx generated successfully at:', targetPath);
  } catch (err) {
    if (err.code === 'EBUSY') {
      console.warn('Avviso: Guida Web App.docx è aperto in un altro programma (es. Word). Il file verrà aggiornato alla chiusura del programma.');
    } else {
      throw err;
    }
  }
}

generateGuidaDocx().catch(console.error);
