const ExcelJS = require('exceljs');
const fs = require('fs');

(async () => {
  console.log('📖 FULL DANH SÁCH ANALYSIS\n');
  
  const coa = new ExcelJS.Workbook();
  await coa.xlsx.readFile('./analyze-coa.xlsx');
  const ws = coa.worksheets[0];
  
  console.log(`Sheet: ${ws.name}`);
  console.log(`Total rows: ${ws.rowCount}\n`);
  
  // Export all data to text file
  let output = 'FULL DANH SÁCH HỆ THỐNG TÀI KHOẢN\n';
  output += '='.repeat(150) + '\n\n';
  
  ws.eachRow((row, rowNumber) => {
    const vals = [];
    for (let j = 1; j <= 6; j++) {
      const v = String(row.getCell(j).value || '').trim();
      vals.push(v.padEnd(25));
    }
    output += `R${String(rowNumber).padStart(4)}: ${vals.join(' | ')}\n`;
  });
  
  fs.writeFileSync('./DANH_SACH_FULL.txt', output);
  console.log('✅ Exported to DANH_SACH_FULL.txt');
  console.log('\nFirst 100 lines:\n');
  console.log(output.split('\n').slice(0, 105).join('\n'));
})();
