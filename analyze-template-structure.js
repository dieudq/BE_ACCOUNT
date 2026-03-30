const ExcelJS = require('exceljs');

(async () => {
  console.log('📊 CASHFLOW TEMPLATE STRUCTURE\n');
  
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  
  const ws = wb.getWorksheet('Cashflow_Misa');
  console.log(`Sheet: ${ws.name} (${ws.rowCount} rows)\n`);
  
  console.log('Scanning rows with category names (Column A + B):\n');
  
  let rowNum = 0;
  ws.eachRow((row, rowNumber) => {
    const colA = String(row.getCell(1).value || '').trim();
    const colB = String(row.getCell(2).value || '').trim();
    
    // Look for rows with meaningful content in A or B (potential categories)
    if ((colA && colA.length > 0) || (colB && colB.length > 0)) {
      if (colA.length > 0 || colB.includes('dự án') || colB.includes('Lương') || colB.includes('Chi')) {
        console.log(`R${String(rowNumber).padStart(4)}: A="${colA.substring(0, 25).padEnd(25)}" | B="${colB.substring(0, 40).padEnd(40)}"`);
        rowNum++;
      }
    }
    
    if (rowNum >= 80) return; // First 80 rows only
  });
  
  console.log('\n\nFull first 30 rows (all columns):');
  rowNum = 0;
  ws.eachRow((row, rowNumber) => {
    if (rowNum >= 30) return;
    
    const vals = [];
    for (let j = 1; j <= 5; j++) {
      const v = String(row.getCell(j).value || '').substring(0, 20);
      vals.push(v.padEnd(20));
    }
    console.log(`R${String(rowNumber).padStart(3)}: ${vals.join(' | ')}`);
    rowNum++;
  });
})();
