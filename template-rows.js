const ExcelJS = require('exceljs');

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('templates/2026_TWD_s_Cashflows_Report.xlsx');
  
  const ws = workbook.getWorksheet('Cashflow_Misa');
  
  console.log('\n===== DETAILED SUB-ROW BREAKDOWN =====\n');
  
  // Check rows 6-22 in detail
  for (let r = 6; r <= 22; r++) {
    const row = ws.getRow(r);
    const colA = String(row.getCell(1).value || '').trim();
    const colB = String(row.getCell(2).value || '').trim();
    const colC = String(row.getCell(3).value || '').substring(0, 40).trim();
    
    console.log(`R${r}: [A:"${colA}"] [B:"${colB}"] [C:"${colC}"]`);
  }
  
  console.log('\n===== ALSO CHECK 23-36 =====\n');
  
  for (let r = 23; r <= 36; r++) {
    const row = ws.getRow(r);
    const colA = String(row.getCell(1).value || '').trim();
    const colB = String(row.getCell(2).value || '').trim();
    const colC = String(row.getCell(3).value || '').substring(0, 40).trim();
    
    console.log(`R${r}: [A:"${colA}"] [B:"${colB}"] [C:"${colC}"]`);
  }
}

main().catch(console.error);
