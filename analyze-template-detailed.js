const ExcelJS = require('exceljs');

(async () => {
  console.log('🔍 DETAILED ACCOUNT ANALYSIS FOR CASHFLOW\n');
  
  // Load Cashflow template
  const tplWb = new ExcelJS.Workbook();
  await tplWb.xlsx.readFile('./templates/2026_TWD_s_Cashflows_Report.xlsx');
  const tplWs = tplWb.getWorksheet('Cashflow_Misa');
  
  // Load NEW Danh sách
  const coaWb = new ExcelJS.Workbook();
  await coaWb.xlsx.readFile('./templates/Danh_sach_he_thong_tai_khoan_NEW.xlsx');
  const coaWs = coaWb.worksheets[0];
  
  // Build account map from Danh sách
  const accounts = {};
  coaWs.eachRow((row, rowNum) => {
    if (rowNum <= 3) return;
    const code = String(row.getCell(2).value || '').trim();
    const name = String(row.getCell(3).value || '').trim();
    if (code && code.length > 0) {
      accounts[code] = name;
    }
  });
  
  console.log(`📊 Loaded ${Object.keys(accounts).length} accounts from Danh sách\n`);
  
  // Analyze each row in template - extract formulas and text
  console.log('🔬 TEMPLATE ROW ANALYSIS:\n');
  console.log('Row | Category Name | Formula in Column F-Z\n');
  console.log('---|---|---');
  
  const categoryData = {};
  
  for (let r = 3; r <= 70; r++) {
    const row = tplWs.getRow(r);
    const colB = String(row.getCell(2).value || '').trim();
    
    if (!colB || colB.length === 0) continue;
    
    // Get first formula cell (F=6, G=7, etc.)
    let formula = null;
    for (let c = 6; c <= 26; c++) {
      const cell = row.getCell(c);
      if (cell.value && typeof cell.value === 'object' && 'formula' in cell.value) {
        formula = cell.value.formula;
        break;
      }
    }
    
    categoryData[r] = { name: colB, formula };
    
    if (formula) {
      console.log(`${r} | ${colB} | ${formula}`);
    }
  }
  
  console.log('\n\n📋 INTERPRETATION:\n');
  
  // Parse formulas to understand what accounts are used
  const parseFormula = (formula) => {
    if (!formula) return [];
    
    // Extract account codes like 515.1, 635.1, G66, etc.
    const matches = formula.match(/[\w\d\.]+/g) || [];
    return matches.filter(m => m.match(/^[\d\.]+$/) || m.match(/^[A-Z]\d+$/));
  };
  
  for (const [row, data] of Object.entries(categoryData)) {
    if (data.formula) {
      const parts = parseFormula(data.formula);
      console.log(`R${row}: ${data.name}`);
      console.log(`  Formula: ${data.formula}`);
      console.log(`  Parts: ${parts.join(', ')}`);
      
      // Check if parts are account codes
      for (const part of parts) {
        if (part.match(/^\d+\.\d+$/)) {
          const name = accounts[part];
          if (name) {
            console.log(`    ✓ ${part}: ${name}`);
          } else {
            console.log(`    ❌ ${part}: NOT FOUND`);
          }
        }
      }
      console.log();
    }
  }
  
  console.log('\n\n⚠️  IMPORTANT:\n');
  console.log('Template uses REFERENCES like "G66" - this means:');
  console.log('- Formulas reference OTHER cells, not direct account codes');
  console.log('- To understand actual mapping, need to check what those cells contain');
  console.log('- Or need to understand Danh sách structure in relation to template');
})();
