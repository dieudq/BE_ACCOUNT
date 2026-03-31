const ExcelJS = require('exceljs');

(async () => {
  console.log('🔍 DETAILED GL VERIFICATION & MAPPING\n');
  
  // Load GL file (latest upload)
  const glWb = new ExcelJS.Workbook();
  await glWb.xlsx.readFile('./uploads/gl_1774931758139_So_chi_tiet_cac_tai_khoan.xlsx');
  const glWs = glWb.worksheets[0];
  
  // Load Danh sách
  const coaWb = new ExcelJS.Workbook();
  await coaWb.xlsx.readFile('./templates/Danh_sach_he_thong_tai_khoan_NEW.xlsx');
  const coaWs = coaWb.worksheets[0];
  
  // Build COA map
  const coaMap = {};
  coaWs.eachRow((row, rowNum) => {
    if (rowNum <= 3) return;
    const code = String(row.getCell(2).value || '').trim();
    const name = String(row.getCell(3).value || '').trim();
    if (code) coaMap[code] = name;
  });
  
  // GL to Sub-row mapping
  const glToSubRow = {
    '515.3': 10, '515.5': 11, '515.2': 12, '711.2': 12, '711.1': 13, '515.1': 14, '635': 14,
    '334.1': 18, '334.2': 19,
    '6422.2': 24, '6422.3': 25, '6422.4': 26,
    '154.1': 29, '154.2': 30,
    '6421.2': 32,
    '6422.6': 35,
    '6421.3': 38, '6421.4': 39, '6421.5': 40, '6421.6': 41, '6421.7': 42,
    '6421.8': 45, '6421.9': 46,
    '821': 54,
    '334-10': 58, '334-11': 59, '334-12': 60, '6421-13': 61, '6421-14': 62,
  };
  
  const monthMap = {
    1: 'G', 2: 'I', 3: 'K', 4: 'M', 5: 'O', 6: 'Q',
    7: 'S', 8: 'U', 9: 'W', 10: 'Y', 11: '[', 12: ']'
  };
  
  console.log('📋 GL FILE TRANSACTIONS:\n');
  
  let rowNum = 0;
  glWs.eachRow((row, idx) => {
    if (idx <= 3) return; // Skip header
    
    rowNum++;
    
    const date = String(row.getCell(1).value || '').trim();
    const account = String(row.getCell(5).value || '').trim();
    const debit = parseFloat(row.getCell(6).value || 0);
    const credit = parseFloat(row.getCell(7).value || 0);
    const description = String(row.getCell(4).value || '').trim();
    
    if (!date || !account) return;
    
    const net = debit - credit;
    
    // Parse month from date (format: dd/mm/yyyy)
    const dateParts = date.split('/');
    let month = 0;
    if (dateParts.length >= 2) {
      month = parseInt(dateParts[1]);
    }
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📌 GL Line ${rowNum}:`);
    console.log(`   Date: ${date}`);
    console.log(`   Account: ${account}`);
    console.log(`   Debit: ${debit.toLocaleString('vi-VN')}`);
    console.log(`   Credit: ${credit.toLocaleString('vi-VN')}`);
    console.log(`   Net: ${net.toLocaleString('vi-VN')}`);
    console.log(`   Description: ${description}`);
    
    // Verify account in Danh sách
    console.log(`\n   ✓ Verify Account:`);
    if (coaMap[account]) {
      console.log(`     ✓ Found: ${account} = "${coaMap[account]}"`);
    } else {
      console.log(`     ❌ NOT FOUND in Danh sách: ${account}`);
      return;
    }
    
    // Map to sub-row
    console.log(`\n   ✓ Map to Sub-row:`);
    const subRow = glToSubRow[account];
    if (subRow) {
      console.log(`     ✓ Account ${account} → Row ${subRow}`);
    } else {
      console.log(`     ❌ No sub-row mapping for ${account}`);
      return;
    }
    
    // Calculate month → column
    console.log(`\n   ✓ Map Month → Column:`);
    if (month >= 1 && month <= 12) {
      const col = monthMap[month];
      const colIdx = 5 + month * 2;
      console.log(`     ✓ Date ${date} → Month ${month} → Column ${col}(${colIdx})`);
    } else {
      console.log(`     ❌ Invalid month: ${month}`);
      return;
    }
    
    // Fill info
    console.log(`\n   ✓ FILL CASHFLOW:`);
    const colLetter = monthMap[month];
    console.log(`     Cell: R${subRow}:${colLetter}`);
    console.log(`     Value: ${net.toLocaleString('vi-VN')}`);
    
    console.log(`\n   ✅ OK - Ready to fill`);
  });
  
  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 SUMMARY: ${rowNum} transactions processed`);
})();
