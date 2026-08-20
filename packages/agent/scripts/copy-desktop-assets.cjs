const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'skills');
const dest = path.join(__dirname, '..', 'dist', 'skills');
fs.mkdirSync(dest, { recursive: true });
for (const name of ['desktop-win.ps1', 'desktop-ocr-win.ps1', 'desktop-ocr.py']) {
  fs.copyFileSync(path.join(src, name), path.join(dest, name));
}
console.log('copied desktop helper assets');
