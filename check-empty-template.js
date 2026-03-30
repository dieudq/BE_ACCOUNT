const ExcelJS = require('exceljs');

(async () => {
  console.log('📊 CHECK TEMPLATE - DATA EMPTY?\n');
  
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('C:\\Users\\ADMIN\\.openclaw\\media\\inbound\\2026_TWD_s_Cashflows_Report---bf361eda-fe87-4f5f-99e1-35da79bfafb5.xlsx');
  
  const ws = wb.getWorksheet('Cashflow_Misa');
  
  console.log('Checking first 50 rows, columns F-Z (data area):\n');
  
  let dataCount = 0;
  let formulaCount = 0;
  
  for (let r = 3; r <= 50; r++) {
    const row = ws.getRow(r);
    
    for (let c = 6; c <= 26; c++) {
      const cell = row.getCell(c);
      if (cell.value) {
        if (typeof cell.value === 'object' && cell.value.formula) {
          formulaCount++;
          console.log(`  R${r}C${c}: FORMULA = ${cell.value.formula}`);
        } else if (typeof cell.value === 'number') {
          dataCount++;
          console.log(`  R${r}C${c}: DATA = ${cell.value}`);
        }
      }
    }
  }
  
  console.log(`\n✅ Summary:`);
  console.log(`   Data cells: ${dataCount}`);
  console.log(`   Formula cells: ${formulaCount}`);
  console.log(`   Status: ${dataCount === 0 ? '✓ RỖNG (good!)' : '❌ HAS DATA'}`);
})();
