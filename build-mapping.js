const ExcelJS = require('exceljs');
const fs = require('fs');

(async () => {
  console.log('📊 COMPREHENSIVE MAPPING ANALYSIS\n');
  
  // Load Cashflow template
  const tplWb = new ExcelJS.Workbook();
  await tplWb.xlsx.readFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  const tplWs = tplWb.getWorksheet('Cashflow_Misa');
  
  // Load NEW Danh sách
  const coaWb = new ExcelJS.Workbook();
  await coaWb.xlsx.readFile('./templates/Danh_sach_he_thong_tai_khoan_NEW.xlsx');
  const coaWs = coaWb.worksheets[0];
  
  console.log('📋 STEP 1: Extract ALL categories from Cashflow template\n');
  
  // Find all category rows (non-empty column B)
  const categories = {};
  let catNum = 0;
  
  for (let r = 3; r <= tplWs.rowCount; r++) {
    const colB = String(tplWs.getRow(r).getCell(2).value || '').trim();
    
    // If column B has text, it's a category
    if (colB && colB.length > 1 && !colB.includes('=') && colB !== 'LÃI/LỖ' && colB !== 'CHI' && colB !== 'THU') {
      categories[r] = colB;
      catNum++;
    }
  }
  
  console.log(`Found ${catNum} categories in template:\n`);
  for (const [row, name] of Object.entries(categories)) {
    console.log(`   R${row}: ${name}`);
  }
  
  // Extract accounts from new Danh sách
  console.log('\n\n📊 STEP 2: Extract ALL accounts from Danh sách\n');
  
  const accounts = {};
  coaWs.eachRow((row, rowNum) => {
    if (rowNum <= 3) return;
    
    const code = String(row.getCell(2).value || '').trim();
    const name = String(row.getCell(3).value || '').trim();
    
    if (code && code.length > 0) {
      accounts[code] = name;
    }
  });
  
  console.log(`Found ${Object.keys(accounts).length} accounts in Danh sách\n`);
  
  // Build mapping table
  console.log('\n📍 STEP 3: Build detailed mapping\n');
  
  const mapping = {
    'Thu dự án': ['511.1', '511.2'],
    'Thu đầu tư tài chính, tiết kiệm': ['515.3'],
    'Thu đầu tư R&D': ['515.5'],
    'Thu khác': ['515.2', '711.2'],
    'Lương dự án': ['334.1', '334.2'],
    'Quản lý bán hàng': ['6421.1', '6421.3', '6421.4', '6421.5', '6421.6'],
    'Quản lý văn phòng': ['6422.1', '6422.2', '6422.3', '6422.4', '6422.5', '6422.7', '6422.8', '6422.9'],
    'Chi phí đảm bảo chất lượng': ['154.1', '154.2', '154.3', '154.5'],
    'Hành chính/ Nhân Sự': ['6421.2'],
    'Kế toán/Tài Chính': ['6422.6'],
    'Sales': ['6421.7'],
    'Marketing': ['6421.8', '6421.9'],
  };
  
  // Verify each mapping
  let output = '✅ MAPPING VERIFICATION:\n\n';
  
  for (const [category, codes] of Object.entries(mapping)) {
    output += `${category}:\n`;
    
    for (const code of codes) {
      if (accounts[code]) {
        output += `   ✓ ${code}: ${accounts[code]}\n`;
      } else {
        output += `   ❌ ${code}: NOT FOUND IN DANH SÁCH\n`;
      }
    }
    output += '\n';
  }
  
  console.log(output);
  
  // Save to file
  fs.writeFileSync('./mapping-verification.txt', output);
  console.log('📄 Saved to mapping-verification.txt');
  
  console.log('\n⚠️  QUESTIONS FOR SẾP:\n');
  console.log('1. Is mapping above correct?');
  console.log('2. Any missing accounts?');
  console.log('3. Any wrong accounts?');
  console.log('4. Danh sách has sub-codes (334.1, 334.2, etc.) - include all in sum? Or only top-level (334)?');
})();
