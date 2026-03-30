const ExcelJS = require('exceljs');

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./uploads/gl_1774857513075_So_chi_tiet_cac_tai_khoan.xlsx');
  
  const ws = wb.worksheets[0];
  console.log(`📊 GL File Structure\n`);
  console.log(`Sheet: ${ws.name}\n`);
  
  console.log('All rows (no filter):');
  let rowNum = 0;
  ws.eachRow((row, rowNumber) => {
    if (rowNum >= 30) return;
    
    const vals = [];
    for (let j = 1; j <= 8; j++) {
      const v = String(row.getCell(j).value || '').substring(0, 18);
      vals.push(v.padEnd(18));
    }
    console.log(`R${String(rowNumber).padStart(3)}: ${vals.join(' | ')}`);
    rowNum++;
  });
})();
