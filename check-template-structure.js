const ExcelJS = require('exceljs');

(async () => {
  console.log('📖 TEMPLATE STRUCTURE - DETAIL ROWS\n');
  
  const tplWb = new ExcelJS.Workbook();
  await tplWb.xlsx.readFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  const tplWs = tplWb.getWorksheet('Cashflow_Misa');
  
  console.log('REVENUE SECTION (R6 subtotal of R7-R15):\n');
  for (let r = 6; r <= 15; r++) {
    const colB = String(tplWs.getRow(r).getCell(2).value || '').trim();
    const colD = String(tplWs.getRow(r).getCell(4).value || '').trim();
    console.log(`  R${r}: Col B="${colB}" | Col D="${colD}"`);
  }
  
  console.log('\n\nEXPENSE SECTIONS (detail rows):\n');
  
  console.log('Lương dự án (R17 subtotal of R18-R22):');
  for (let r = 17; r <= 22; r++) {
    const colB = String(tplWs.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${colB}`);
  }
  
  console.log('\nQuản lý văn phòng (R23 subtotal of R24-R26):');
  for (let r = 23; r <= 26; r++) {
    const colB = String(tplWs.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${colB}`);
  }
  
  console.log('\nChi phí đảm bảo chất lượng (R28 subtotal of R29-R30):');
  for (let r = 28; r <= 30; r++) {
    const colB = String(tplWs.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${colB}`);
  }
  
  console.log('\nHành chính/Nhân Sự (R31 subtotal of R32-R33):');
  for (let r = 31; r <= 33; r++) {
    const colB = String(tplWs.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${colB}`);
  }
  
  console.log('\nKế toán/Tài Chính (R34 subtotal of R35-R36):');
  for (let r = 34; r <= 36; r++) {
    const colB = String(tplWs.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${colB}`);
  }
  
  console.log('\nSales (R37 subtotal of R38-R43):');
  for (let r = 37; r <= 43; r++) {
    const colB = String(tplWs.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${colB}`);
  }
  
  console.log('\nMarketing (R44 subtotal of R45-R48):');
  for (let r = 44; r <= 48; r++) {
    const colB = String(tplWs.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${colB}`);
  }
  
  console.log('\nHạ tầng IT (R49 subtotal of R50-R52):');
  for (let r = 49; r <= 52; r++) {
    const colB = String(tplWs.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${colB}`);
  }
  
  console.log('\nThuế & Bảo hiểm (R53 subtotal of R54-R56):');
  for (let r = 53; r <= 56; r++) {
    const colB = String(tplWs.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${colB}`);
  }
  
  console.log('\nThưởng/Bonus (R57 subtotal of R58-R62):');
  for (let r = 57; r <= 62; r++) {
    const colB = String(tplWs.getRow(r).getCell(2).value || '').trim();
    console.log(`  R${r}: ${colB}`);
  }
})();
