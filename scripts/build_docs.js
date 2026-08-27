import fs from 'fs';
import path from 'path';
import { Document, Packer, Paragraph, HeadingLevel, TextRun, ImageRun, Bookmark, InternalHyperlink } from 'docx';

const IT_LANG = { value: "it-IT", eastAsia: "it-IT", bidirectional: "it-IT" };

function getBookmarkId(text) {
  const match = text.match(/^(\d+(?:\.\d+)?)/);
  if (match) {
    return 'sec-' + match[1].replace('.', '-');
  }
  return 'sec-' + text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function parseMarkdownLineToRuns(text) {
  const runs = [];
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true, language: IT_LANG }));
    } else if (part.startsWith('*') && part.endsWith('*')) {
      runs.push(new TextRun({ text: part.slice(1, -1), italic: true, language: IT_LANG }));
    } else {
      runs.push(new TextRun({ text: part, language: IT_LANG }));
    }
  }
  return runs.length > 0 ? runs : [new TextRun({ text, language: IT_LANG })];
}

function makeHeading(text, heading, spacing) {
  const bookmarkId = getBookmarkId(text);
  return new Paragraph({
    children: [
      new Bookmark({
        id: bookmarkId,
        children: [new TextRun({ text, language: IT_LANG })]
      })
    ],
    heading,
    spacing
  });
}

async function generateDocs() {
  const mdPath = path.join(process.cwd(), 'File Utili', 'Guida Web App.md');
  const docxGuidePath = path.join(process.cwd(), 'File Utili', 'Guida Web App.docx');
  const docxChangelogPath = path.join(process.cwd(), 'File Utili', 'Changelog_Pianificazione_Aziendale.docx');

  const mdContent = fs.readFileSync(mdPath, 'utf-8');
  const lines = mdContent.split('\n');

  const children = [];

  // Inserimento Logo Ingegno in cima
  const logoPath = path.join(process.cwd(), 'public', 'Logo.png');
  if (fs.existsSync(logoPath)) {
    const logoBuffer = fs.readFileSync(logoPath);
    children.push(new Paragraph({
      children: [
        new ImageRun({
          data: logoBuffer,
          transformation: {
            width: 220,
            height: 62,
          },
        })
      ],
      spacing: { before: 100, after: 250 }
    }));
  }

  children.push(makeHeading("Manuale Operativo e Guida Web App", HeadingLevel.TITLE, { after: 150 }));
  children.push(new Paragraph({
    children: [
      new TextRun({
        text: "Pianificazione e Gestione Aziendale — Versione 1.0.14 (Agosto 2026)",
        bold: true,
        italic: true,
        language: IT_LANG
      })
    ],
    spacing: { after: 350 }
  }));

  let inIndexSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || trimmed === '---' || trimmed.startsWith('---') || trimmed.startsWith('title:') || trimmed.startsWith('subtitle:') || trimmed.startsWith('date:') || trimmed.startsWith('lang:')) {
      continue;
    }

    if (trimmed.startsWith('![](') || trimmed.includes('Logo.png')) {
      continue; // Logo già gestito in cima
    }

    if (trimmed.startsWith('# Indice dei Contenuti') || trimmed.startsWith('# Sommario')) {
      inIndexSection = true;
      children.push(makeHeading(trimmed.replace('# ', ''), HeadingLevel.HEADING_1, { before: 300, after: 120 }));
      continue;
    }

    if (inIndexSection && trimmed.startsWith('# ') && !trimmed.includes('Indice') && !trimmed.includes('Sommario')) {
      inIndexSection = false;
    }

    if (inIndexSection && (trimmed.startsWith('- ') || line.startsWith('  - ') || line.startsWith('    - '))) {
      const isSub = line.startsWith('  - ') || line.startsWith('    - ');
      const rawText = trimmed.replace(/^-\s*/, '').replace(/\*\*/g, '');
      const bookmarkId = getBookmarkId(rawText);

      children.push(new Paragraph({
        children: [
          new InternalHyperlink({
            anchor: bookmarkId,
            children: [
              new TextRun({
                text: rawText,
                bold: !isSub,
                color: "1A56DB",
                underline: {},
                language: IT_LANG
              })
            ]
          })
        ],
        bullet: isSub ? { level: 1 } : { level: 0 },
        spacing: { after: 60 }
      }));
      continue;
    }

    if (trimmed.startsWith('# ')) {
      children.push(makeHeading(trimmed.replace('# ', ''), HeadingLevel.HEADING_1, { before: 320, after: 140 }));
    } else if (trimmed.startsWith('## ')) {
      children.push(makeHeading(trimmed.replace('## ', ''), HeadingLevel.HEADING_2, { before: 240, after: 100 }));
    } else if (trimmed.startsWith('### ')) {
      children.push(makeHeading(trimmed.replace('### ', ''), HeadingLevel.HEADING_3, { before: 180, after: 80 }));
    } else {
      children.push(new Paragraph({
        children: parseMarkdownLineToRuns(trimmed),
        spacing: { after: 100 }
      }));
    }
  }

  const docGuide = new Document({
    styles: {
      default: {
        document: {
          run: {
            language: IT_LANG
          }
        }
      }
    },
    sections: [{ children }]
  });

  const guideBuffer = await Packer.toBuffer(docGuide);
  fs.writeFileSync(docxGuidePath, guideBuffer);
  console.log('Guida Web App.docx generata con successo!');

  // Genera Changelog completo da Changelog_Pianificazione_Aziendale.md
  const changelogMdPath = path.join(process.cwd(), 'File Utili', 'Changelog_Pianificazione_Aziendale.md');
  const changelogChildren = [
    makeHeading("Changelog e Storico Aggiornamenti — Pianificazione Aziendale", HeadingLevel.TITLE, { after: 250 })
  ];

  if (fs.existsSync(changelogMdPath)) {
    const changelogMdContent = fs.readFileSync(changelogMdPath, 'utf-8');
    const clLines = changelogMdContent.split('\n');
    
    for (const rawLine of clLines) {
      const line = rawLine.trimEnd();
      const trimmed = line.trim();
      if (!trimmed || trimmed === '---' || trimmed.startsWith('---') || trimmed.startsWith('# ')) {
        continue;
      }
      
      if (trimmed.startsWith('## ')) {
        changelogChildren.push(makeHeading(trimmed.replace('## ', ''), HeadingLevel.HEADING_1, { before: 360, after: 140 }));
      } else if (trimmed.startsWith('### ')) {
        changelogChildren.push(makeHeading(trimmed.replace('### ', ''), HeadingLevel.HEADING_2, { before: 240, after: 100 }));
      } else if (line.startsWith('  - ') || line.startsWith('    - ')) {
        const content = line.replace(/^\s*-\s*/, '');
        changelogChildren.push(new Paragraph({
          children: parseMarkdownLineToRuns(content),
          bullet: { level: 1 },
          spacing: { after: 60 }
        }));
      } else if (line.startsWith('- ') || trimmed.startsWith('- ')) {
        const content = trimmed.replace(/^-\s*/, '');
        changelogChildren.push(new Paragraph({
          children: parseMarkdownLineToRuns(content),
          bullet: { level: 0 },
          spacing: { before: 80, after: 60 }
        }));
      } else {
        changelogChildren.push(new Paragraph({
          children: parseMarkdownLineToRuns(trimmed),
          spacing: { after: 100 }
        }));
      }
    }
  }

  const docChangelog = new Document({
    styles: {
      default: {
        document: {
          run: {
            language: IT_LANG
          }
        }
      }
    },
    sections: [{ children: changelogChildren }]
  });

  const changelogBuffer = await Packer.toBuffer(docChangelog);
  fs.writeFileSync(docxChangelogPath, changelogBuffer);
  console.log('Changelog_Pianificazione_Aziendale.docx generato con successo!');
}

generateDocs().catch(console.error);
