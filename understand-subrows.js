const ExcelJS = require('exceljs');

(async () => {
  console.log('🔍 TEMPLATE SUB-ROWS STRUCTURE\n');
  
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  const ws = wb.getWorksheet('Cashflow_Misa');
  
  console.log('📋 CATEGORY + SUB-ROWS:\n');
  
  // Revenue section
  console.log('REVENUE:');
  console.log('R5: THU (header)');
  console.log('R6: Thu dự án (TOTAL)');
  for (let r = 7; r <= 15; r++) {
    const name = String(ws.getRow(r).getCell(2).value || '').trim();
    if (name) {
      console.log(`  R${r}: ${name} (SUB-ROW - fill here!)`);
    }
  }
  
  console.log('\nEXPENSE:');
  console.log('R16: CHI (header)');
  
  console.log('\nR17: Lương dự án (TOTAL) = SUM(G18:G22)');
  for (let r = 18; r <= 22; r++) {
    const name = String(ws.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${name} (SUB-ROW - fill here!)`);
  }
  
  console.log('\nR23: Quản lý văn phòng (TOTAL) = SUM(G24:G26)');
  for (let r = 24; r <= 26; r++) {
    const name = String(ws.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${name} (SUB-ROW - fill here!)`);
  }
  
  console.log('\nR28: Chi phí đảm bảo chất lượng (TOTAL) = SUM(G29:G30)');
  for (let r = 29; r <= 30; r++) {
    const name = String(ws.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${name} (SUB-ROW - fill here!)`);
  }
  
  console.log('\nR31: Hành chính/Nhân Sự (TOTAL) = SUM(G32:G33)');
  for (let r = 32; r <= 33; r++) {
    const name = String(ws.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${name} (SUB-ROW - fill here!)`);
  }
  
  console.log('\nR34: Kế toán/Tài Chính (TOTAL) = SUM(G35:G36)');
  for (let r = 35; r <= 36; r++) {
    const name = String(ws.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${name} (SUB-ROW - fill here!)`);
  }
  
  console.log('\nR37: Sales (TOTAL) = SUM(G38:G43)');
  for (let r = 38; r <= 43; r++) {
    const name = String(ws.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${name} (SUB-ROW - fill here!)`);
  }
  
  console.log('\nR44: Marketing (TOTAL) = SUM(G45:G48)');
  for (let r = 45; r <= 48; r++) {
    const name = String(ws.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${name} (SUB-ROW - fill here!)`);
  }
  
  console.log('\nR49: Hạ tầng IT (TOTAL) = SUM(G50:G52)');
  for (let r = 50; r <= 52; r++) {
    const name = String(ws.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${name} (SUB-ROW - fill here!)`);
  }
  
  console.log('\n\n⚠️  IMPORTANT:\n');
  console.log('Categories (R6, R17, R23, etc.) have formulas!');
  console.log('They SUM the sub-rows (R7-R15, R18-R22, etc.)');
  console.log('SO: Fill SUB-ROWS, NOT categories → Formulas calculate automatically');
})();
