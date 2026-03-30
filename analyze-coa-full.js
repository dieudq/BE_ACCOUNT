const ExcelJS = require('exceljs');

(async () => {
  console.log('🔍 Looking for category mapping in Danh sách...\n');
  
  const coa = new ExcelJS.Workbook();
  await coa.xlsx.readFile('./analyze-coa.xlsx');
  const ws = coa.worksheets[0];
  
  console.log(`Sheet: ${ws.name}\n`);
  
  // Get all columns
  console.log('Headers (Row 3):');
  const headerRow = ws.getRow(3);
  for (let i = 1; i <= 20; i++) {
    const val = headerRow.getCell(i).value;
    if (val) console.log(`  Col ${i}: ${val}`);
  }
  
  // Show sample rows with all columns
  console.log('\n\nAll data rows (up to col 10):\n');
  let rowNum = 0;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= 3) return; // Skip header
    if (rowNum >= 50) return;
    
    const vals = [];
    for (let j = 1; j <= 10; j++) {
      const v = String(row.getCell(j).value || '').substring(0, 16);
      vals.push(v.padEnd(16));
    }
    console.log(`R${String(rowNumber).padStart(3)}: ${vals.join(' | ')}`);
    rowNum++;
  });
})();
