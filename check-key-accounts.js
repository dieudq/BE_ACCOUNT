const ExcelJS = require('exceljs');

(async () => {
  console.log('📋 DANH SÁCH - KEY ACCOUNTS FOR CASHFLOW\n');
  
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./templates/Danh_sach_he_thong_tai_khoan.xlsx');
  
  const ws = wb.worksheets[0];
  
  const prefixes = ['154', '334', '511', '513', '515', '635', '711', '81', '82'];
  
  for (const prefix of prefixes) {
    console.log(`\n${prefix}.x accounts:`);
    
    let count = 0;
    ws.eachRow((row, rowNum) => {
      if (rowNum <= 3) return;
      
      const code = String(row.getCell(2).value || '').trim();
      const name = String(row.getCell(3).value || '').trim();
      
      if (code.startsWith(prefix)) {
        console.log(`  ${code}: ${name}`);
        count++;
      }
    });
    
    if (count === 0) {
      console.log('  (Not found)');
    }
  }
})();
