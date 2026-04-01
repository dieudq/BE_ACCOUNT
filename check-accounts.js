const ExcelJS = require('exceljs');

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('templates/Danh_sach_he_thong_tai_khoan.xlsx');
  
  const ws = workbook.worksheets[0];
  const accounts = new Map();
  
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= 3) return;
    
    const code = String(row.getCell(2).value || '').trim();
    const name = String(row.getCell(3).value || '').trim();
    
    if (code && code.length > 0) {
      accounts.set(code, name);
    }
  });
  
  // Check what accounts exist in the 500s (Revenue) and 600s (Expenses)
  console.log('\n===== CHECKING REVENUE ACCOUNTS (500-700s) =====\n');
  
  const revenuePatterns = ['511', '515.1', '515.2', '515.3', '515.5', '711', '711.1', '711.2'];
  revenuePatterns.forEach(pattern => {
    const name = accounts.get(pattern);
    if (name) {
      console.log(`✓ ${pattern}: ${name}`);
    } else {
      console.log(`✗ ${pattern}: NOT FOUND`);
    }
  });
  
  console.log('\n===== CHECKING SALARY/WAGE ACCOUNTS (300s) =====\n');
  
  const salaryPatterns = ['334', '334.1', '334.2', '334.4', '334.9', '334.10', '334.11', '334.12'];
  salaryPatterns.forEach(pattern => {
    const name = accounts.get(pattern);
    if (name) {
      console.log(`✓ ${pattern}: ${name}`);
    } else {
      console.log(`✗ ${pattern}: NOT FOUND`);
    }
  });
  
  console.log('\n===== CHECKING ADMIN/EXPENSE ACCOUNTS (6400s) =====\n');
  
  const expensePatterns = ['6421', '6421.2', '6421.3', '6421.4', '6421.5', '6421.6', '6421.7', '6421.8', '6421.9', 
                           '6421.12', '6421.13', '6421.14',
                           '6422', '6422.2', '6422.3', '6422.4', '6422.6', '154', '154.1', '154.2'];
  expensePatterns.forEach(pattern => {
    const name = accounts.get(pattern);
    if (name) {
      console.log(`✓ ${pattern}: ${name}`);
    } else {
      console.log(`✗ ${pattern}: NOT FOUND`);
    }
  });
  
  console.log('\n===== ALL 500-700 CODES (Revenue) =====\n');
  for (const [code, name] of accounts) {
    if (code.startsWith('5') || code.startsWith('7')) {
      console.log(`${code}: ${name}`);
    }
  }
  
  console.log('\n===== ALL 334.x CODES (Salary) =====\n');
  for (const [code, name] of accounts) {
    if (code.startsWith('334')) {
      console.log(`${code}: ${name}`);
    }
  }
  
  console.log('\n===== ALL 6421.x, 6422.x CODES (Admin/Sales/Marketing) =====\n');
  for (const [code, name] of accounts) {
    if (code.startsWith('6421') || code.startsWith('6422')) {
      console.log(`${code}: ${name}`);
    }
  }
  
  console.log('\n===== ALL 154.x CODES (QA Cost) =====\n');
  for (const [code, name] of accounts) {
    if (code.startsWith('154')) {
      console.log(`${code}: ${name}`);
    }
  }
}

main().catch(console.error);
