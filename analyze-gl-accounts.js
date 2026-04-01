const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

async function analyzeGL() {
  // Use the latest GL file
  const latestFile = 'uploads/gl_1775016755146_So_chi_tiet_cac_tai_khoan.xlsx';
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(latestFile);
  
  const ws = workbook.worksheets[0];
  const accounts = new Map();
  const transactions = [];
  
  let headerRow = 0;
  ws.eachRow((row, rowNumber) => {
    if (!headerRow && String(row.getCell(1).value || '').includes('Ngày hạch toán')) {
      headerRow = rowNumber;
      return;
    }
    
    if (!headerRow || rowNumber <= headerRow) return;
    
    const date = row.getCell(1).value;
    const vDate = row.getCell(2).value;
    const vNo = row.getCell(3).value;
    const desc = String(row.getCell(4).value || '').trim();
    const counterAcct = String(row.getCell(5).value || '').trim();
    const debit = row.getCell(6).value || 0;
    const credit = row.getCell(7).value || 0;
    
    if (!counterAcct || (debit === 0 && credit === 0)) return;
    
    if (!accounts.has(counterAcct)) {
      accounts.set(counterAcct, []);
    }
    accounts.get(counterAcct).push({
      date, vNo, desc, debit: Number(debit) || 0, credit: Number(credit) || 0
    });
    
    transactions.push({
      counterAcct, desc, debit: Number(debit) || 0, credit: Number(credit) || 0
    });
  });
  
  console.log(`\n===== GL ANALYSIS =====\n`);
  console.log(`Total transactions: ${transactions.length}`);
  console.log(`Total unique accounts: ${accounts.size}`);
  
  console.log('\n===== ACCOUNTS FOUND =====\n');
  const sortedAccounts = Array.from(accounts.keys()).sort();
  sortedAccounts.forEach(acct => {
    const txns = accounts.get(acct);
    const totalDebit = txns.reduce((sum, t) => sum + t.debit, 0);
    const totalCredit = txns.reduce((sum, t) => sum + t.credit, 0);
    console.log(`${acct}: ${txns.length} txns | Debit: ${totalDebit.toLocaleString('vi-VN')} | Credit: ${totalCredit.toLocaleString('vi-VN')}`);
  });
  
  // Now check which accounts DON'T have mapping
  console.log('\n===== CHECKING MAPPING STATUS =====\n');
  
  // Load the mapping function logic
  const mapAccountToCategory = (accountCode) => {
    const code = accountCode.trim();
    
    if (code.startsWith('511')) return 'Thu dự án';
    if (code === '515.3') return 'Thu đầu tư tài chính, tiết kiệm';
    if (code === '515.5') return 'Thu đầu tư R&D';
    if (code === '515.2') return 'Thu khác';
    if (code === '711.2') return 'Thu khác';
    if (code === '334.1' || code === '334.2') return 'Lương dự án';
    if (code.startsWith('6422') && code !== '6422.6') return 'Quản lý văn phòng';
    if (code === '6421.2') return 'Hành chính/ Nhân Sự';
    if (code === '6422.6') return 'Kế toán/Tài Chính';
    if (code === '6421.3' || code === '6421.4' || code === '6421.5' || code === '6421.6') return 'Sales';
    if (code === '6421.8' || code === '6421.9') return 'Marketing';
    if (code.startsWith('154')) return 'Chi phí đảm bảo chất lượng';
    
    return 'Unknown';
  };
  
  const mappedAccounts = new Map();
  const unmappedAccounts = new Map();
  
  sortedAccounts.forEach(acct => {
    const category = mapAccountToCategory(acct);
    if (category === 'Unknown') {
      unmappedAccounts.set(acct, accounts.get(acct).length);
    } else {
      if (!mappedAccounts.has(category)) {
        mappedAccounts.set(category, []);
      }
      mappedAccounts.get(category).push(acct);
    }
  });
  
  console.log(`✓ Mapped: ${mappedAccounts.size} categories`);
  mappedAccounts.forEach((acctsInCat, category) => {
    const totalTxns = acctsInCat.reduce((sum, a) => sum + (accounts.get(a) || []).length, 0);
    console.log(`  - ${category}: ${acctsInCat.join(', ')} (${totalTxns} transactions)`);
  });
  
  console.log(`\n✗ Unmapped: ${unmappedAccounts.size} accounts`);
  unmappedAccounts.forEach((txnCount, acct) => {
    console.log(`  - ${acct} (${txnCount} transactions) - NEEDS MAPPING!`);
  });
}

analyzeGL().catch(console.error);
