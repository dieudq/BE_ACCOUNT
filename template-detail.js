const ExcelJS = require('exceljs');

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('templates/2026_TWD_s_Cashflows_Report.xlsx');
  
  const ws = workbook.getWorksheet('Cashflow_Misa');
  
  console.log('\n===== TEMPLATE SUB-ROW STRUCTURE =====\n');
  
  // Extract all rows with structure
  for (let r = 3; r <= 65; r++) {
    const row = ws.getRow(r);
    const colA = String(row.getCell(1).value || '').trim();
    const colB = String(row.getCell(2).value || '').trim();
    const colC = String(row.getCell(3).value || '').trim();
    
    if (colB && colB.length > 0) {
      console.log(`R${r}: [A: "${colA}"] [B: "${colB}"] [C: "${colC}"]`);
    }
  }
}

main().catch(console.error);
