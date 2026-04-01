const ExcelJS = require('exceljs');

// Load the mapping functions  
function mapAccountToCategory(accountCode) {
  const code = accountCode.trim();

  // REVENUE (THU)
  if (code.startsWith('511') || code === '5118') return 'Thu dự án';
  if (code === '515.3') return 'Thu đầu tư tài chính, tiết kiệm';
  if (code === '515.5' || code === '515.4') return 'Thu đầu tư R&D';
  if (code === '515.2' || code === '711.2') return 'Thu khác';
  
  // SALARY
  if (code === '334.1' || code === '334.2') return 'Lương dự án';
  if (code === '334.3') return 'Hành chính/ Nhân Sự';
  if (code === '334.4') return 'Lương dự án';
  if (code === '334.5') return 'Hành chính/ Nhân Sự';
  if (code === '334.6') return 'Sales';
  if (code === '334.7') return 'Marketing';
  if (code === '334.8') return 'Hành chính/ Nhân Sự';
  if (code === '331') return 'Hành chính/ Nhân Sự';
  
  // ADMIN
  if (code.startsWith('6422') && code !== '6422.6') return 'Quản lý văn phòng';
  if (code === '6422.6') return 'Kế toán/Tài Chính';
  if (code === '6421.2') return 'Hành chính/ Nhân Sự';
  if (code === '6421.3' || code === '6421.4' || code === '6421.5' || code === '6421.6' || code === '6421.7') return 'Sales';
  if (code === '6421.8' || code === '6421.9') return 'Marketing';
  if (code === '6421-11') return 'Sales';
  if (code === '6421-15') return 'Marketing';
  if (code === '6421-19') return 'Sales';
  
  // QA
  if (code.startsWith('154')) return 'Chi phí đảm bảo chất lượng';
  
  // OTHER
  if (code === '811' || code === '1111' || code === '1113' || 
      code === '1121.1' || code === '1121.7' || code === '131.1' || 
      code === '131.2' || code === '2411') {
    if (code === '811') return 'Chi phí đảm bảo chất lượng';
    return 'Unknown';
  }
  
  return 'Unknown';
}

const glToSubRow = {
  '511': 7, '511.1': 7, '511.2': 7, '511.3': 7, '5113': 7, '5113.1': 7, '5113.2': 7, '5111': 8, '5112': 8, '5118': 9,
  '515.3': 10, '515.5': 11, '515.4': 15,
  '515.2': 12, '711.2': 12, '711.1': 13, '515.1': 14, '635': 14,
  '334.1': 18, '334.2': 19, '334.4': 18,
  '6422.2': 25, '6422.3': 26, '6422.4': 26, '6422.5': 24,
  '154.1': 29, '154.2': 30, '154.3': 30,
  '6421.2': 32, '331': 32, '334.3': 32, '334.5': 32, '334.8': 33,
  '6422.6': 35,
  '6421.3': 38, '6421.4': 39, '6421.5': 40, '6421.6': 41, '6421.7': 42, '6421-19': 43, '6421-11': 42, '334.6': 38,
  '6421.8': 46, '6421.9': 47, '6421-15': 45, '334.7': 46,
  '811': 63, '2411': 64,
  '1111': 7, '1113': 7, '1121.1': 7, '1121.7': 7, '131.1': 7, '131.2': 7,
};

async function analyzeMapping() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('uploads/gl_1775016755146_So_chi_tiet_cac_tai_khoan.xlsx');
  
  const ws = workbook.worksheets[0];
  const results = {
    mapped: [],
    subRowMapped: [],
    noCategory: [],
    noSubRow: [],
  };
  
  let txnCount = 0;
  let headerRow = 0;
  
  ws.eachRow((row, rowNumber) => {
    if (!headerRow && String(row.getCell(1).value || '').includes('Ngày hạch toán')) {
      headerRow = rowNumber;
      return;
    }
    
    if (!headerRow || rowNumber <= headerRow) return;
    
    const counterAcct = String(row.getCell(5).value || '').trim();
    const debit = row.getCell(6).value || 0;
    const credit = row.getCell(7).value || 0;
    
    if (!counterAcct || (debit === 0 && credit === 0)) return;
    
    txnCount++;
    const desc = String(row.getCell(4).value || '');
    const category = mapAccountToCategory(counterAcct);
    const subRow = glToSubRow[counterAcct];
    
    if (category === 'Unknown') {
      results.noCategory.push({ txn: txnCount, acct: counterAcct, desc });
    } else if (!subRow) {
      results.noSubRow.push({ txn: txnCount, acct: counterAcct, category, desc });
    } else {
      results.subRowMapped.push({ txn: txnCount, acct: counterAcct, category, subRow, desc });
    }
  });
  
  console.log('\n===== MAPPING VALIDATION REPORT =====\n');
  console.log(`Total transactions: ${txnCount}`);
  console.log(`✓ Fully mapped (category + sub-row): ${results.subRowMapped.length}`);
  console.log(`⚠️  Category mapped but no sub-row: ${results.noSubRow.length}`);
  console.log(`✗ No category mapped: ${results.noCategory.length}`);
  
  if (results.noCategory.length > 0) {
    console.log('\n❌ ACCOUNTS WITHOUT CATEGORY MAPPING:');
    results.noCategory.forEach(r => {
      console.log(`  Txn ${r.txn}: ${r.acct} - "${r.desc}"`);
    });
  }
  
  if (results.noSubRow.length > 0) {
    console.log('\n⚠️  ACCOUNTS WITH CATEGORY BUT NO SUB-ROW MAPPING:');
    results.noSubRow.forEach(r => {
      console.log(`  Txn ${r.txn}: ${r.acct} (${r.category}) - "${r.desc}"`);
    });
  }
  
  if (results.subRowMapped.length > 0) {
    console.log('\n✓ FULLY MAPPED TRANSACTIONS:');
    results.subRowMapped.forEach(r => {
      console.log(`  Txn ${r.txn}: ${r.acct} → R${r.subRow} (${r.category})`);
    });
  }
  
  console.log(`\n✅ RESULT: ${results.subRowMapped.length}/${txnCount} transactions will be filled correctly`);
}

analyzeMapping().catch(console.error);
