const ExcelJS = require('exceljs');

(async () => {
  console.log('🔍 CHECK TEMPLATE - CELLS = 0 (READY TO FILL)\n');
  
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  const ws = wb.getWorksheet('Cashflow_Misa');
  
  // Month columns: F(6)=Jan, H(8)=Feb, J(10)=Mar, L(12)=Apr, N(14)=May, P(16)=Jun
  //              R(18)=Jul, T(20)=Aug, V(22)=Sep, X(24)=Oct, Z(26)=Nov, \(28)=Dec
  const months = [
    { col: 6, letter: 'F', name: 'Jan' },
    { col: 8, letter: 'H', name: 'Feb' },
    { col: 10, letter: 'J', name: 'Mar' },
    { col: 12, letter: 'L', name: 'Apr' },
    { col: 14, letter: 'N', name: 'May' },
    { col: 16, letter: 'P', name: 'Jun' },
    { col: 18, letter: 'R', name: 'Jul' },
    { col: 20, letter: 'T', name: 'Aug' },
    { col: 22, letter: 'V', name: 'Sep' },
    { col: 24, letter: 'X', name: 'Oct' },
    { col: 26, letter: 'Z', name: 'Nov' },
    { col: 28, letter: '\\', name: 'Dec' }
  ];
  
  // Top-level categories
  const categories = [
    6, 10, 11, 12, 13, 14, // Revenue
    17, 23, 28, 31, 34, 37, 44, 49, 53, 57 // Expense
  ];
  
  console.log('TEMPLATE STRUCTURE - CELLS = 0:\n');
  
  for (const cat of categories) {
    const row = ws.getRow(cat);
    const catName = String(row.getCell(2).value || '').trim();
    
    if (!catName) continue;
    
    console.log(`\nR${cat}: ${catName}`);
    
    for (const month of months) {
      const cell = row.getCell(month.col);
      const value = cell.value;
      
      if (value === 0) {
        console.log(`  ✓ ${month.letter}${cat} (${month.name}): = 0 [READY]`);
      } else if (value === null || value === undefined) {
        console.log(`  • ${month.letter}${cat} (${month.name}): empty [null]`);
      } else if (typeof value === 'object' && value.formula) {
        console.log(`  ⊘ ${month.letter}${cat} (${month.name}): formula = ${value.formula}`);
      } else {
        console.log(`  ⊘ ${month.letter}${cat} (${month.name}): = ${value}`);
      }
    }
  }
  
  console.log('\n\n📊 SUMMARY:\n');
  console.log('✓ = 0: Ready to fill with GL data');
  console.log('• empty: Cell is null (can fill if needed)');
  console.log('⊘ formula/other: Already has value or formula, DON\'T TOUCH');
})();
