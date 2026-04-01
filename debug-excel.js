const ExcelJS = require('exceljs');
const path = require('path');

async function inspectTemplate() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('templates/2026_TWD_s_Cashflows_Report.xlsx');
  
  const ws = workbook.getWorksheet('Cashflow_Misa');
  console.log('\n========== TEMPLATE STRUCTURE ==========\n');
  
  console.log('Row 1-2 (Headers):');
  for (let r = 1; r <= 2; r++) {
    const row = ws.getRow(r);
    let line = `R${r}: `;
    for (let c = 1; c <= 8; c++) {
      const val = row.getCell(c).value;
      line += `[${String.fromCharCode(64+c)}: ${String(val).substring(0,20)}] `;
    }
    console.log(line);
  }
  
  console.log('\nRows 3-60 (Categories & Sub-rows):');
  for (let r = 3; r <= 60; r++) {
    const row = ws.getRow(r);
    const colA = String(row.getCell(1).value || '').trim();
    const colB = String(row.getCell(2).value || '').trim();
    const colC = String(row.getCell(3).value || '').trim();
    
    if (colB && colB.length > 0) {
      console.log(`R${r}: [A: "${colA}"] [B: "${colB}"] [C: "${colC}"]`);
    }
  }
}

async function inspectChartOfAccounts() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('templates/Danh_sach_he_thong_tai_khoan.xlsx');
  
  const ws = workbook.worksheets[0];
  console.log('\n========== CHART OF ACCOUNTS ==========\n');
  
  console.log('First 50 accounts (Column B=Code, C=Name, D=Type):');
  let rowCount = 0;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= 3) return; // Skip headers
    if (rowCount >= 50) return;
    
    const code = String(row.getCell(2).value || '').trim();
    const name = String(row.getCell(3).value || '').trim();
    const type = String(row.getCell(4).value || '').trim();
    
    if (code && code.length > 0) {
      console.log(`R${rowNumber}: [Code: ${code}] [Name: ${name}] [Type: ${type}]`);
      rowCount++;
    }
  });
}

async function main() {
  try {
    await inspectTemplate();
    await inspectChartOfAccounts();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
