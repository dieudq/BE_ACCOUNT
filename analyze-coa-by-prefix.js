const ExcelJS = require('exceljs');

(async () => {
  console.log('📋 DANH SÁCH ACCOUNTS BY PREFIX\n');
  
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./templates/Danh_sach_he_thong_tai_khoan.xlsx');
  
  const ws = wb.worksheets[0];
  
  const accounts = {};
  
  ws.eachRow((row, rowNum) => {
    if (rowNum <= 3) return; // Skip headers
    
    const code = String(row.getCell(2).value || '').trim();
    const name = String(row.getCell(3).value || '').trim();
    
    if (code && code.length > 0) {
      const prefix = code.split('.')[0]; // Get prefix (111, 6421, etc.)
      
      if (!accounts[prefix]) {
        accounts[prefix] = [];
      }
      accounts[prefix].push({ code, name });
    }
  });
  
  // Show accounts by prefix
  const prefixes = Object.keys(accounts).sort();
  
  for (const prefix of prefixes) {
    const items = accounts[prefix];
    console.log(`\n${prefix}.x (${items.length} accounts):`);
    items.forEach(item => {
      console.log(`  - ${item.code}: ${item.name}`);
    });
  }
})();
