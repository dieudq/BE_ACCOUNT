const ExcelJS = require('exceljs');

(async () => {
  console.log('📊 TEMPLATE STRUCTURE CHECK\n');
  
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  
  const ws = wb.getWorksheet('Cashflow_Misa');
  
  // Row 2: Headers
  console.log('Row 2 (Headers):');
  const row2 = ws.getRow(2);
  for (let col = 1; col <= 30; col++) {
    const val = row2.getCell(col).value;
    const colLetter = String.fromCharCode(64 + col);
    if (val) {
      console.log(`  ${colLetter}: ${val}`);
    }
  }
  
  console.log('\n\nColumn mapping (Actual = Data columns):');
  console.log('  E (5) = January Actual');
  console.log('  G (7) = February Actual');
  console.log('  I (9) = March Actual');
  console.log('  K (11) = April Actual');
  console.log('  M (13) = May Actual');
  console.log('  O (15) = June Actual');
  console.log('  Q (17) = July Actual');
  console.log('  S (19) = August Actual');
  console.log('  U (21) = September Actual');
  console.log('  W (23) = October Actual');
  console.log('  Y (25) = November Actual');
  console.log('  AA (27) = December Actual');
  
  console.log('\n\nSample rows (Category names):');
  for (let r = 1; r <= 30; r++) {
    const row = ws.getRow(r);
    const colA = row.getCell(1).value;
    const colB = row.getCell(2).value;
    const colC = row.getCell(3).value;
    
    if (colB && String(colB).trim().length > 0) {
      console.log(`  R${r}: B="${String(colB).substring(0, 30)}"`);
    }
  }
})();
