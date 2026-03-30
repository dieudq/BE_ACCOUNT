const ExcelJS = require('exceljs');

(async () => {
  console.log('🧹 Clear data from template (keep formulas)...\n');
  
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  
  const ws = wb.getWorksheet('Cashflow_Misa');
  
  console.log('Clearing numeric data (rows 3+, columns F-Z)...');
  
  let cleared = 0;
  
  // Clear data from row 3 onwards, columns F-Z (data columns)
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    
    // Columns F-Z = 6-26 (data columns)
    for (let c = 6; c <= 26; c++) {
      const cell = row.getCell(c);
      
      // Check if cell has numeric value or formula
      if (cell.value) {
        // If it's a formula, keep it
        if (typeof cell.value === 'object' && cell.value.formula) {
          // Keep formula
          continue;
        }
        
        // If it's a number or text in data area, clear it
        if (typeof cell.value === 'number' || 
            (typeof cell.value === 'string' && !cell.value.includes('='))) {
          cell.value = null;
          cleared++;
        }
      }
    }
    
    if (r % 100 === 0) {
      console.log(`  ...${r} rows (cleared ${cleared} cells)`);
    }
  }
  
  console.log(`✅ Cleared ${cleared} data cells`);
  console.log('   - Formulas: KEPT');
  console.log('   - Formatting: KEPT');
  console.log('   - Headers: KEPT');
  
  // Save back
  await wb.xlsx.writeFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  
  console.log('\n✅ Template updated (data cleared, formulas kept)');
})();
