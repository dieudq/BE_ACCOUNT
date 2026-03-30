const ExcelJS = require('exceljs');

(async () => {
  console.log('🎯 PRECISE MAPPING CHECK\n');
  
  // Load Danh sách (Chart of Accounts)
  const coaWb = new ExcelJS.Workbook();
  await coaWb.xlsx.readFile('./templates/Danh_sach_he_thong_tai_khoan.xlsx');
  const coaWs = coaWb.worksheets[0];
  
  const accounts = {};
  coaWs.eachRow((row, rowNum) => {
    if (rowNum <= 3) return;
    const code = String(row.getCell(2).value || '').trim();
    const name = String(row.getCell(3).value || '').trim();
    if (code && code.length > 0) {
      accounts[code] = name;
    }
  });
  
  // Load template
  const tmplWb = new ExcelJS.Workbook();
  await tmplWb.xlsx.readFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  const tmplWs = tmplWb.getWorksheet('Cashflow_Misa');
  
  console.log('📋 TEMPLATE TOP-LEVEL CATEGORIES:\n');
  
  // Find top-level category rows (those with content in B, no formula in A, or B has category name)
  const topLevelRows = [];
  tmplWs.eachRow((row, rowNum) => {
    if (rowNum <= 5) return; // Skip header
    
    const colA = row.getCell(1).value;
    const colB = String(row.getCell(2).value || '').trim();
    
    // Top-level = Column B has category name that looks like main category
    if (colB && colB.length > 0 && !colB.includes('--')) {
      const isMainCategory = 
        colB === 'Thu dự án' ||
        colB === 'Thu đầu tư tài chính, tiết kiệm' ||
        colB === 'Thu đầu tư R&D' ||
        colB === 'Thu khác' ||
        colB === 'Lương dự án' ||
        colB === 'Quản lý bán hàng' ||
        colB === 'Quản lý văn phòng' ||
        colB === 'Chi phí đảm bảo chất lượng' ||
        colB === 'Hành chính/ Nhân Sự' ||
        colB === 'Kế toán/Tài Chính' ||
        colB === 'Sales' ||
        colB === 'Marketing' ||
        colB === 'Hạ tầng IT' ||
        colB === 'CHI' ||
        colB === 'THU';
      
      if (isMainCategory) {
        topLevelRows.push({
          row: rowNum,
          name: colB,
          formula: colA
        });
      }
    }
  });
  
  topLevelRows.forEach(item => {
    console.log(`R${item.row}: "${item.name}"`);
    if (item.formula) {
      console.log(`         Formula: ${item.formula}`);
    }
  });
  
  console.log('\n\n📊 GL ACCOUNT PREFIXES (from Danh sách):\n');
  
  const prefixes = {};
  Object.entries(accounts).forEach(([code, name]) => {
    const prefix = code.split('.')[0];
    if (!prefixes[prefix]) {
      prefixes[prefix] = [];
    }
    prefixes[prefix].push({ code, name });
  });
  
  // Show key prefixes
  const keyPrefixes = ['111', '112', '131', '154', '334', '511', '515', '635', '711', '81', '82', '6421', '6422'];
  
  for (const prefix of keyPrefixes) {
    if (prefixes[prefix]) {
      console.log(`${prefix}:`);
      prefixes[prefix].forEach(item => {
        console.log(`  - ${item.code}: ${item.name}`);
      });
    }
  }
  
  console.log('\n\n❓ QUESTION FOR SẾP:\n');
  console.log('Which template rows should we fill? (Confirm list)');
  console.log('Which GL accounts go to which row? (Confirm mapping)');
})();
