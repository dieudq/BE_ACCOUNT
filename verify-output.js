const ExcelJS = require('exceljs');

(async () => {
  console.log('✅ VERIFY OUTPUT FILE\n');
  
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./output-check.xlsx');
  const ws = wb.getWorksheet('Cashflow_Misa');
  
  console.log('📊 DATA FILLED:\n');
  
  // Check key categories
  const cats = [6, 10, 11, 12, 13, 14, 17, 23, 28, 31, 34, 37, 44, 49, 53, 57];
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
  
  for (const cat of cats) {
    const row = ws.getRow(cat);
    const catName = String(row.getCell(2).value || '').trim();
    
    if (!catName) continue;
    
    console.log(`\nR${cat}: ${catName}`);
    
    let hasFill = false;
    for (const m of months) {
      const cell = row.getCell(m.col);
      const val = cell.value;
      
      if (val && val !== 0 && typeof val === 'number') {
        console.log(`  ${m.letter}${cat} (${m.name}): ✓ ${val.toLocaleString('vi-VN')}`);
        hasFill = true;
      } else if (val !== null && val !== undefined && typeof val === 'object' && val.formula) {
        // Formula - don't show details
      }
    }
    
    if (!hasFill) {
      // Check if any cell has formula with value
      let hasFormula = false;
      for (const m of months) {
        const cell = row.getCell(m.col);
        const val = cell.value;
        if (val && typeof val === 'object' && val.formula) {
          hasFormula = true;
          break;
        }
      }
      if (hasFormula) {
        console.log(`  [All columns have formulas, no direct data]`);
      } else {
        console.log(`  [No data]`);
      }
    }
  }
  
  console.log('\n\n✅ CHECK COMPLETE');
})();
