const ExcelJS = require('exceljs');
const path = require('path');

(async () => {
  const wb = new ExcelJS.Workbook();
  const templatePath = path.join(process.cwd(), 'templates/2026_TWD_s_Cashflows_Report.xlsx');
  
  try {
    await wb.xlsx.readFile(templatePath);
    
    console.log('📊 TEMPLATE DETAILED STRUCTURE\n');
    console.log(`📋 Total sheets: ${wb.worksheets.length}`);
    
    wb.worksheets.forEach((ws, sheetIdx) => {
      console.log(`\n📄 Sheet ${sheetIdx + 1}: "${ws.name}" (${ws.rowCount} rows × ${ws.columnCount} cols)`);
      
      console.log('\n   First 40 rows (focus on structure):');
      for (let i = 1; i <= Math.min(40, ws.rowCount); i++) {
        const row = ws.getRow(i);
        const vals = [];
        
        // Get first 15 columns
        for (let j = 1; j <= Math.min(15, ws.columnCount); j++) {
          const cell = row.getCell(j);
          let val = String(cell.value || '').substring(0, 15);
          vals.push(val);
        }
        
        console.log(`   R${String(i).padStart(3)}: ${vals.join(' | ')}`);
      }
      
      // Find category rows (Column A contains meaningful text)
      console.log('\n   🔍 Categories found (Column A):');
      let catCount = 0;
      for (let i = 1; i <= ws.rowCount && catCount < 20; i++) {
        const cellA = ws.getCell(`A${i}`).value;
        if (cellA && String(cellA).trim().length > 0 && !String(cellA).toLowerCase().includes('tháng')) {
          console.log(`   R${i}: ${String(cellA).substring(0, 40)}`);
          catCount++;
        }
      }
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
})();
