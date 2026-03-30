const ExcelJS = require('exceljs');

(async () => {
  console.log('📊 TEMPLATE STRUCTURE - DETAILED CHECK\n');
  
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  
  const ws = wb.getWorksheet('Cashflow_Misa');
  
  console.log('🔍 First 50 rows - Column A (formulas/info) + Column B (category names):\n');
  
  for (let r = 1; r <= 50; r++) {
    const row = ws.getRow(r);
    const colA = row.getCell(1).value;
    const colB = row.getCell(2).value;
    
    // Show if either A or B has content
    if (colA || colB) {
      const aStr = colA ? String(colA).substring(0, 30).padEnd(30) : ''.padEnd(30);
      const bStr = colB ? String(colB).substring(0, 40).padEnd(40) : '';
      console.log(`R${String(r).padStart(2)}: A="${aStr}" | B="${bStr}"`);
    }
  }
})();
