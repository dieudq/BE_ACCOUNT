const ExcelJS = require('exceljs');
const path = require('path');

async function debugExcel() {
  const latestFile = path.join(process.cwd(), 'exports', 'cashflow_2026-01.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(latestFile);
  const worksheet = workbook.getWorksheet('Cashflow_Misa');

  if (!worksheet) {
    console.log('Error: Cashflow_Misa sheet not found');
    return;
  }

  const getValRaw = (row, col) => {
    const cell = worksheet.getRow(row).getCell(col);
    return {
      value: cell.value,
      type: cell.type,
      effectiveType: typeof cell.value,
      isFormula: cell.type === ExcelJS.ValueType.Formula,
      result: cell.value && typeof cell.value === 'object' ? cell.value.result : 'N/A'
    };
  };

  const rows = Array.from({length: 70}, (_, i) => i + 1);
  const col = 7; // G = Jan

  console.log(`Month T1 (Col 7) all rows:`);
  rows.forEach(r => {
    const raw = getValRaw(r, col);
    if (raw.value !== null && raw.value !== undefined) {
        console.log(`Row ${r}:`, JSON.stringify(raw, null, 2));
    }
  });
}

debugExcel();
