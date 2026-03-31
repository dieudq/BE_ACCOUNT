const ExcelJS = require('exceljs');

(async () => {
  console.log('🔍 VERIFY EXACT COLUMN MAPPING\n');
  
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  const ws = wb.getWorksheet('Cashflow_Misa');
  
  console.log('📋 ROW 1-2 HEADERS (Column mapping):\n');
  console.log('Col | Letter | R1 Header | R2 Header | Type');
  console.log('---|--------|-----------|-----------|------');
  
  for (let c = 1; c <= 30; c++) {
    const r1 = String(ws.getRow(1).getCell(c).value || '').trim();
    const r2 = String(ws.getRow(2).getCell(c).value || '').trim();
    const letter = String.fromCharCode(64 + c);
    
    if (r1 || r2) {
      const type = r2 === 'Jan' || r2 === 'Feb' || r2 === 'March' || r2 === 'April' || 
                   r2 === 'May' || r2 === 'June' || r2 === 'July' || r2 === 'August' ||
                   r2 === 'September' || r2 === 'October' || r2 === 'November' || r2 === 'December'
                   ? 'MONTH' : 'OTHER';
      
      console.log(`${c.toString().padEnd(3)} | ${letter.padEnd(6)} | ${r1.padEnd(9)} | ${r2.padEnd(9)} | ${type}`);
    }
  }
  
  console.log('\n\n🎯 ACTUAL MONTHS (fill these columns only):\n');
  
  const actualMonths = [
    { col: 6, letter: 'F', month: 'January' },
    { col: 8, letter: 'H', month: 'February' },
    { col: 10, letter: 'J', month: 'March' },
    { col: 12, letter: 'L', month: 'April' },
    { col: 14, letter: 'N', month: 'May' },
    { col: 16, letter: 'P', month: 'June' },
    { col: 18, letter: 'R', month: 'July' },
    { col: 20, letter: 'T', month: 'August' },
    { col: 22, letter: 'V', month: 'September' },
    { col: 24, letter: 'X', month: 'October' },
    { col: 26, letter: 'Z', month: 'November' },
    { col: 28, letter: '\\', month: 'December' }
  ];
  
  for (const m of actualMonths) {
    const r2 = String(ws.getRow(2).getCell(m.col).value || '').trim();
    console.log(`${m.letter}(${m.col}): ${m.month.padEnd(12)} - Header: "${r2}"`);
  }
  
  console.log('\n\n⚠️  PLAN COLUMNS (skip these):\n');
  
  const planMonths = [
    { col: 7, letter: 'G', month: 'January Plan' },
    { col: 9, letter: 'I', month: 'February Plan' },
    { col: 11, letter: 'K', month: 'March Plan' },
    { col: 13, letter: 'M', month: 'April Plan' },
    { col: 15, letter: 'O', month: 'May Plan' },
    { col: 17, letter: 'Q', month: 'June Plan' },
    { col: 19, letter: 'S', month: 'July Plan' },
    { col: 21, letter: 'U', month: 'August Plan' },
    { col: 23, letter: 'W', month: 'September Plan' },
    { col: 25, letter: 'Y', month: 'October Plan' },
    { col: 27, letter: '[', month: 'November Plan' },
    { col: 29, letter: ']', month: 'December Plan' }
  ];
  
  for (const m of planMonths) {
    const r2 = String(ws.getRow(2).getCell(m.col).value || '').trim();
    console.log(`${m.letter}(${m.col}): ${m.month.padEnd(17)} - Header: "${r2}"`);
  }
  
  console.log('\n\n✅ CODE MAPPING:\n');
  console.log('Month 1-12 → Column (Actual)');
  console.log('Formula: colIndex = 4 + month * 2');
  console.log('  Month 1 (Jan) → 4 + 1*2 = 6 (F)');
  console.log('  Month 2 (Feb) → 4 + 2*2 = 8 (H)');
  console.log('  Month 3 (Mar) → 4 + 3*2 = 10 (J)');
  console.log('  ...');
  console.log('  Month 12 (Dec) → 4 + 12*2 = 28 (\\)');
})();
