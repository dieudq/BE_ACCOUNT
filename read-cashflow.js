const ExcelJS = require('exceljs');
const path = require('path');

(async () => {
  try {
    const file = path.join(process.cwd(), 'exports/cashflow_2026-01.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);

    const worksheets = workbook.worksheets;
    console.log('📊 SHEETS:', worksheets.map(ws => ws.name));

    const ws = worksheets[0];
    console.log('\n📋 SHEET NAME:', ws.name);
    console.log('DIMENSIONS:', ws.dimensions);
    console.log('\n=== FIRST 40 ROWS ===\n');

    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= 40) {
        const values = [];
        for (let col = 1; col <= 20; col++) {
          const cell = row.getCell(col);
          let val = '';
          if (cell.value !== null && cell.value !== undefined) {
            val = String(cell.value).substring(0, 20);
          }
          values.push(val);
        }
        console.log(`Row ${rowNumber}: ${values.join(' | ')}`);
      }
    });
  } catch (error) {
    console.error('Error:', error.message);
  }
})();

