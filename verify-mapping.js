const ExcelJS = require('exceljs');

(async () => {
  console.log('🔍 VERIFY MAPPING - TEMPLATE vs DANH SÁCH\n');
  
  // Load template
  const tplWb = new ExcelJS.Workbook();
  await tplWb.xlsx.readFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  const tplWs = tplWb.getWorksheet('Cashflow_Misa');
  
  // Load Danh sách
  const coaWb = new ExcelJS.Workbook();
  await coaWb.xlsx.readFile('./templates/Danh_sach_he_thong_tai_khoan.xlsx');
  const coaWs = coaWb.worksheets[0]; // Get first sheet (has trailing space in name)
  
  console.log('📋 TEMPLATE STRUCTURE:');
  console.log('   Row | Category Name');
  
  const rows = [6, 10, 11, 12, 17, 23, 28, 31, 34, 37, 44, 49];
  const templateCategories = {};
  
  for (const r of rows) {
    const name = tplWs.getRow(r).getCell(2).value;
    templateCategories[r] = name;
    console.log(`   ${r}   | ${name}`);
  }
  
  console.log('\n📊 DANH SÁCH ACCOUNTS BY PREFIX:');
  
  const prefixes = {
    '511': 'Revenue',
    '515': 'Financial income',
    '635': 'Financial expense',
    '334': 'Salary',
    '6421': 'Admin sub',
    '6422': 'Admin sub',
    '154': 'QA Cost',
    '711': 'Other income',
    '81': 'Other expense',
    '82': 'Tax expense',
  };
  
  // Extract accounts from Danh sách
  const accounts = {};
  coaWs.eachRow((row, rowNum) => {
    if (rowNum <= 3) return;
    const code = String(row.getCell(2).value || '').trim();
    const name = String(row.getCell(3).value || '').trim();
    
    if (code && code.length > 0) {
      const prefix = code.split('.')[0];
      if (!accounts[prefix]) {
        accounts[prefix] = [];
      }
      accounts[prefix].push({ code, name });
    }
  });
  
  // Show by prefix
  for (const [prefix, list] of Object.entries(accounts)) {
    if (list.length <= 3) {
      console.log(`\n${prefix}.x (${list.length} accounts):`);
      for (const acc of list) {
        console.log(`   ${acc.code}: ${acc.name}`);
      }
    } else {
      console.log(`\n${prefix}.x (${list.length} accounts):`);
      for (let i = 0; i < 2; i++) {
        console.log(`   ${list[i].code}: ${list[i].name}`);
      }
      console.log(`   ... (${list.length - 2} more)`);
    }
  }
  
  console.log('\n\n⚠️  MAPPING QUESTIONS TO VERIFY:');
  console.log('1. R6 "Thu dự án" ← 511.x (Revenue) ✓?');
  console.log('2. R10 "Thu đầu tư tài chính, tiết kiệm" ← 515.3 only? ✓?');
  console.log('3. R11 "Thu đầu tư R&D" ← 515.5 only? ✓?');
  console.log('4. R12 "Thu khác" ← 515.2 + 711.2? ✓?');
  console.log('5. R17 "Lương dự án" ← 334.1, 334.2? ✓?');
  console.log('6. R23 "Quản lý văn phòng" ← 6422.x (not 6422.6)? ✓?');
  console.log('7. R28 "Chi phí đảm bảo chất lượng" ← 154.x? ✓?');
  console.log('8. R31 "Hành chính/Nhân Sự" ← 6421.2? ✓?');
  console.log('9. R34 "Kế toán/Tài Chính" ← 6422.6? ✓?');
  console.log('10. R37 "Sales" ← 6421.3, 6421.4, 6421.5, 6421.6? ✓?');
  console.log('11. R44 "Marketing" ← 6421.8, 6421.9? ✓?');
  console.log('12. R49 "Hạ tầng IT" ← ???');
})();
