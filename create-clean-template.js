const ExcelJS = require('exceljs');
const path = require('path');

(async () => {
  console.log('🧹 Creating clean template (no data, no formulas)...\n');
  
  const srcWb = new ExcelJS.Workbook();
  await srcWb.xlsx.readFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  
  const srcWs = srcWb.getWorksheet('Cashflow_Misa');
  
  // Create new workbook
  const newWb = new ExcelJS.Workbook();
  const newWs = newWb.addWorksheet('Cashflow_Misa');
  
  console.log('Copying formatting only (skip all data/formulas)...');
  
  // Copy all rows/columns with format, but NO data
  for (let r = 1; r <= srcWs.rowCount; r++) {
    const srcRow = srcWs.getRow(r);
    const dstRow = newWs.getRow(r);
    
    for (let c = 1; c <= 30; c++) {
      const srcCell = srcRow.getCell(c);
      const dstCell = dstRow.getCell(c);
      
      // Copy FORMATTING ONLY
      if (srcCell.font) dstCell.font = { ...srcCell.font };
      if (srcCell.fill) dstCell.fill = { ...srcCell.fill };
      if (srcCell.alignment) dstCell.alignment = { ...srcCell.alignment };
      if (srcCell.border) dstCell.border = { ...srcCell.border };
      if (srcCell.numFmt) dstCell.numFmt = srcCell.numFmt;
      
      // DO NOT copy any values or formulas
      // Leave all cells empty
    }
    
    if (r % 100 === 0) {
      console.log(`  ...${r} rows`);
    }
  }
  
  console.log(`✅ Processed ${srcWs.rowCount} rows`);
  
  // Save
  const outputPath = './templates/2026_TWD_s_Cashflows_Report_CLEAN.xlsx';
  await newWb.xlsx.writeFile(outputPath);
  
  console.log(`\n✅ Clean template saved: ${outputPath}`);
  console.log('   - All formatting preserved (colors, fonts, borders)');
  console.log('   - All data/formulas removed');
  console.log('   - Ready to use as copy source');
})();
