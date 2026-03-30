const ExcelJS = require('exceljs');

(async () => {
  console.log('📊 CHART OF ACCOUNTS (Danh sách)\n');
  
  const coa = new ExcelJS.Workbook();
  await coa.xlsx.readFile('./analyze-coa.xlsx');
  const ws1 = coa.worksheets[0];
  
  console.log(`Sheet: ${ws1.name}\n`);
  console.log('First 30 rows:\n');
  
  let rowNum = 0;
  ws1.eachRow((row, rowNumber) => {
    if (rowNum >= 30) return;
    
    const vals = [];
    for (let j = 1; j <= 6; j++) {
      const v = String(row.getCell(j).value || '').substring(0, 20);
      vals.push(v.padEnd(20));
    }
    console.log(`R${String(rowNumber).padStart(3)}: ${vals.join(' | ')}`);
    rowNum++;
  });
  
  console.log('\n\n📄 GL DETAIL (Sổ chi tiết)\n');
  
  const gl = new ExcelJS.Workbook();
  await gl.xlsx.readFile('./analyze-gl.xlsx');
  const ws2 = gl.worksheets[0];
  
  console.log(`Sheet: ${ws2.name}\n`);
  console.log('First 20 rows:\n');
  
  rowNum = 0;
  ws2.eachRow((row, rowNumber) => {
    if (rowNum >= 20) return;
    
    const vals = [];
    for (let j = 1; j <= 7; j++) {
      const v = String(row.getCell(j).value || '').substring(0, 15);
      vals.push(v.padEnd(15));
    }
    console.log(`R${String(rowNumber).padStart(3)}: ${vals.join(' | ')}`);
    rowNum++;
  });
})();
