const ExcelJS = require('exceljs');

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('templates/2026_TWD_s_Cashflows_Report.xlsx');
  
  const ws = workbook.getWorksheet('Cashflow_Misa');
  
  console.log('\n===== DETAILED TEMPLATE ROW MAPPING =====\n');
  
  // Define categories and their expected row ranges
  const categories = [
    { name: 'Thu dự án', startRow: 6, endRow: 10 },
    { name: 'Thu đầu tư tài chính, tiết kiệm', startRow: 10, endRow: 11 },
    { name: 'Thu đầu tư R&D', startRow: 11, endRow: 12 },
    { name: 'Thu khác', startRow: 12, endRow: 16 },
    { name: 'Lương dự án', startRow: 17, endRow: 23 },
    { name: 'Quản lý văn phòng', startRow: 23, endRow: 28 },
    { name: 'Chi phí đảm bảo chất lượng', startRow: 28, endRow: 31 },
    { name: 'Hành chính/ Nhân Sự', startRow: 31, endRow: 34 },
    { name: 'Kế toán/Tài Chính', startRow: 34, endRow: 37 },
    { name: 'Sales', startRow: 37, endRow: 44 },
    { name: 'Marketing', startRow: 44, endRow: 49 },
    { name: 'Hạ tầng IT', startRow: 49, endRow: 53 },
    { name: 'Thuế & Bảo hiểm', startRow: 53, endRow: 57 },
    { name: 'Thưởng (Bonus)', startRow: 57, endRow: 65 },
  ];
  
  categories.forEach(cat => {
    console.log(`\n${cat.name} (R${cat.startRow}-${cat.endRow}):`);
    for (let r = cat.startRow; r <= cat.endRow; r++) {
      const row = ws.getRow(r);
      const colA = String(row.getCell(1).value || '').trim();
      const colB = String(row.getCell(2).value || '').trim();
      const colC = String(row.getCell(3).value || '').substring(0, 50).trim();
      
      if (colB || colA) {
        const acctCode = colA ? `[${colA}]` : '';
        console.log(`  R${r}: ${acctCode} ${colB || '(sub-row)'} - ${colC}`);
      }
    }
  });
}

main().catch(console.error);
