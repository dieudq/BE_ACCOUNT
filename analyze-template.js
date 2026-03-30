const ExcelJS = require('exceljs');
const path = require('path');

(async () => {
  const wb = new ExcelJS.Workbook();
  
  // Load template
  const templatePath = path.join(__dirname, 'media-uploads', '2026_TWD_s_Cashflows_Report---c2e16911-10cc-44d9-956c-51c286e68014.xlsx');
  
  try {
    await wb.xlsx.readFile(templatePath);
    
    console.log('✅ Template loaded');
    console.log('📊 Sheets:', wb.sheetCount);
    
    wb.eachSheet((sheet, index) => {
      console.log(`\n📄 Sheet ${index + 1}: ${sheet.name}`);
      console.log(`   Rows: ${sheet.rowCount}, Cols: ${sheet.columnCount}`);
      
      // Print first 3 rows
      for (let i = 1; i <= 3; i++) {
        const row = sheet.getRow(i);
        console.log(`   Row ${i}:`, row.values.slice(0, 15));
      }
    });
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
})();
