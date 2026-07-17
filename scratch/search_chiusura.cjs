const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\e.bartalucci.INGEGNO.001\\Documents\\Antigravity\\pianificazione-aziendale\\src\\pages\\Presenze.tsx', 'utf8');

const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.includes('isInChiusuraAziendaleLocal') || line.includes('isChiusura')) {
    console.log(`${index + 1}: ${line.trim()}`);
  }
});
