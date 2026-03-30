import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Cashflow Template Service
 * LOGIC:
 * 1. Load template as REFERENCE (extract headers, structure, formatting only)
 * 2. Parse GL data, calculate totals
 * 3. CREATE NEW Excel workbook from scratch
 * 4. Populate new file with GL data using template structure
 * 5. Export completely new file
 * 
 * Key: Output file = NEW file, NOT edited template
 */
@Injectable()
export class CashflowTemplateService {
  private templateDir = path.join(process.cwd(), 'templates');

  /**
   * Load template as reference (structure only)
   */
  async loadTemplateAsReference(): Promise<ExcelJS.Workbook> {
    if (!fs.existsSync(this.templateDir)) {
      throw new Error('Templates directory not found');
    }

    const templates = fs
      .readdirSync(this.templateDir)
      .filter((f) => f.includes('Cashflows_Report'));

    if (templates.length === 0) {
      throw new Error('No Cashflow template found');
    }

    const templateFile = path.join(this.templateDir, templates[0]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templateFile);

    console.log(`✅ Template reference loaded: ${templates[0]}`);
    return workbook;
  }

  /**
   * Extract template reference structure (headers, columns, formatting)
   */
  extractTemplateStructure(template: ExcelJS.Workbook): {
    sheetName: string;
    headerRows: any[];
    columnCount: number;
  } {
    const sourceSheet = template.getWorksheet('Cashflow_Misa');
    if (!sourceSheet) {
      throw new Error('Template sheet "Cashflow_Misa" not found');
    }

    console.log('📋 Extracting template structure...');

    // Extract first 2 rows (headers + month names)
    const headerRows: any[] = [];
    for (let i = 1; i <= 2; i++) {
      const row = sourceSheet.getRow(i);
      const values: any[] = [];
      for (let j = 1; j <= sourceSheet.columnCount; j++) {
        values.push({
          value: row.getCell(j).value,
          font: row.getCell(j).font,
          fill: row.getCell(j).fill,
          alignment: row.getCell(j).alignment,
          border: row.getCell(j).border,
        });
      }
      headerRows.push(values);
    }

    return {
      sheetName: sourceSheet.name,
      headerRows,
      columnCount: sourceSheet.columnCount,
    };
  }

  /**
   * Calculate GL totals by category
   */
  calculateCategoryTotals(
    glData: Map<string, { debit: number; credit: number }>,
  ): Map<string, number> {
    const totals = new Map<string, number>();

    console.log('🧮 Calculating GL totals by category...');

    let thu = 0; // 515.x
    let chi = 0; // 635.x
    let taiChinhThuNhap = 0; // 81x
    let taiChinhChi = 0; // 82x
    let tienMat = 0; // 1111

    for (const [account, amounts] of glData.entries()) {
      console.log(`   Account ${account}: Debit=${amounts.debit}, Credit=${amounts.credit}`);

      if (account.startsWith('515')) {
        thu += amounts.debit;
      } else if (account.startsWith('635')) {
        chi += amounts.credit;
      } else if (account.startsWith('81')) {
        taiChinhThuNhap += amounts.debit;
      } else if (account.startsWith('82')) {
        taiChinhChi += amounts.credit;
      } else if (account === '1111') {
        tienMat += amounts.debit - amounts.credit;
      }
    }

    totals.set('Thu dự án', thu);
    totals.set('Chi dự án', chi);
    totals.set('Tài chính thu nhập', taiChinhThuNhap);
    totals.set('Tài chính chi', taiChinhChi);
    totals.set('Tiền mặt', tienMat);

    console.log('\n✅ Category Totals:');
    totals.forEach((value, category) => {
      console.log(`   ${category}: ${value.toLocaleString('vi-VN')}`);
    });

    return totals;
  }

  /**
   * Create NEW workbook (not copy of template)
   * Use template structure as reference only
   * Populate with GL data
   */
  async createNewFileWithGLData(
    templateRef: ExcelJS.Workbook,
    categoryTotals: Map<string, number>,
    month: number,
  ): Promise<ExcelJS.Workbook> {
    console.log('\n📝 Creating NEW Cashflow file from GL data...');

    // Extract template structure
    const templateStruct = this.extractTemplateStructure(templateRef);

    // Create NEW workbook
    const newWorkbook = new ExcelJS.Workbook();
    const newSheet = newWorkbook.addWorksheet(templateStruct.sheetName);

    // Copy headers from template
    console.log('📋 Copying headers...');
    templateStruct.headerRows.forEach((headerRow, rowIdx) => {
      const newRow = newSheet.getRow(rowIdx + 1);
      headerRow.forEach((cell, colIdx) => {
        const newCell = newRow.getCell(colIdx + 1);
        newCell.value = cell.value;
        if (cell.font) newCell.font = { ...cell.font };
        if (cell.fill) newCell.fill = { ...cell.fill };
        if (cell.alignment) newCell.alignment = { ...cell.alignment };
        if (cell.border) newCell.border = { ...cell.border };
      });
    });

    // Month column index: Mar = columns I & J (9 & 10)
    const monthColIndex = 3 + month * 2; // Formula for month-based column

    console.log(
      `\n📊 Populating GL data at column ${String.fromCharCode(64 + monthColIndex)}...`,
    );

    // Add GL data rows (starting from row 3)
    let rowNum = 3;
    categoryTotals.forEach((value, category) => {
      const row = newSheet.getRow(rowNum);
      row.getCell(2).value = category; // Column B: Category name
      row.getCell(monthColIndex).value = value; // Month column: GL value
      row.getCell(monthColIndex).numFmt = '#,##0';
      console.log(
        `   R${rowNum}C${monthColIndex}: "${category}" = ${value.toLocaleString('vi-VN')}`,
      );
      rowNum++;
    });

    console.log('\n✅ New file created with GL data');
    return newWorkbook;
  }

  /**
   * Export new file to Excel
   */
  async exportToExcel(
    workbook: ExcelJS.Workbook,
    outputDir: string,
    filename?: string,
  ): Promise<string> {
    const outPath = path.join(
      outputDir,
      filename || `cashflow_${Date.now()}.xlsx`,
    );

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    await workbook.xlsx.writeFile(outPath);
    console.log(`✅ Exported new file: ${outPath}`);
    return outPath;
  }
}
