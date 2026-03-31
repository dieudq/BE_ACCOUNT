const ExcelJS = require('exceljs');

(async () => {
  console.log('🔍 RE-CHECK TEMPLATE - STRUCTURE FOR FILLING\n');
  
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  const ws = wb.getWorksheet('Cashflow_Misa');
  
  console.log('📋 COLUMNS HEADER (Row 1-2):\n');
  for (let c = 1; c <= 30; c++) {
    const r1 = ws.getRow(1).getCell(c).value;
    const r2 = ws.getRow(2).getCell(c).value;
    if (r1 || r2) {
      const letter = String.fromCharCode(64 + c);
      console.log(`  Col ${letter}(${c}): R1="${r1}" | R2="${r2}"`);
    }
  }
  
  console.log('\n📍 CATEGORY ROWS (R3-R70):\n');
  
  const categoryRows = [];
  for (let r = 3; r <= 70; r++) {
    const colB = String(ws.getRow(r).getCell(2).value || '').trim();
    if (colB && colB.length > 1) {
      categoryRows.push({ row: r, name: colB });
      console.log(`  R${r}: ${colB}`);
    }
  }
  
  console.log('\n\n🎯 FILL POINTS - Where to put GL data?\n');
  
  // Month columns (Actual only)
  const months = [
    { col: 6, letter: 'F', num: 1, name: 'Jan' },
    { col: 8, letter: 'H', num: 2, name: 'Feb' },
    { col: 10, letter: 'J', num: 3, name: 'Mar' },
  ];
  
  for (const cat of categoryRows.slice(0, 5)) {  // First 5 categories
    console.log(`\n${cat.name} (R${cat.row}):`);
    
    for (const m of months) {
      const cell = ws.getRow(cat.row).getCell(m.col);
      const val = cell.value;
      
      let status = '';
      if (val === null || val === undefined) {
        status = '✓ EMPTY (ready to fill)';
      } else if (val === 0) {
        status = '✓ = 0 (ready to fill)';
      } else if (typeof val === 'object' && val.formula) {
        status = `⊘ FORMULA: ${val.formula}`;
      } else {
        status = `⊘ VALUE: ${val}`;
      }
      
      console.log(`  ${m.letter}${cat.row} (${m.name}): ${status}`);
    }
  }
  
  console.log('\n\n📊 RECOMMENDATION:\n');
  console.log('Fill pattern: Category Row (R6, R10, R11, etc.) × Month Column (F, H, J, L, N, P, R, T, V, X, Z, \\)');
  console.log('\nExample: GL account mapped to "Thu dự án" (R6) for Jan month → Fill cell F6');
})();
