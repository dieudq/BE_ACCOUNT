const ExcelJS = require('exceljs');

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./check-output.xlsx');
  
  const ws = wb.worksheets[0];
  console.log(`📊 Checking output file\n`);
  console.log(`Sheet: ${ws.name} (${ws.rowCount} rows × ${ws.columnCount} cols)\n`);
  
  console.log('First 20 rows + all columns:');
  for (let i = 1; i <= Math.min(20, ws.rowCount); i++) {
    const row = ws.getRow(i);
    const vals = [];
    for (let j = 1; j <= Math.min(15, ws.columnCount); j++) {
      const v = row.getCell(j).value;
      vals.push(String(v || '').substring(0, 12).padEnd(12));
    }
    console.log(`R${String(i).padStart(3)}: ${vals.join(' | ')}`);
  }
  
  console.log('\n\n🔍 Looking for GL values (Thu dự án, Chi dự án):');
  for (let i = 1; i <= Math.min(50, ws.rowCount); i++) {
    const row = ws.getRow(i);
    const colB = String(row.getCell(2).value || '');
    
    if (colB.includes('Thu dự án') || colB.includes('Chi dự án')) {
      console.log(`\nFound at R${i}: "${colB}"`);
      for (let j = 1; j <= 15; j++) {
        const cell = row.getCell(j);
        const colName = String.fromCharCode(64 + j);
        console.log(`  ${colName}: ${cell.value}`);
      }
    }
  }
})();
