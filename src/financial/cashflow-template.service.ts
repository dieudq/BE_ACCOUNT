import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

export interface GLCategoryData {
  [key: string]: number;
}

/**
 * Cashflow Template Service
 * LOGIC:
 * 1. Load template as REFERENCE (structure/format only)
 * 2. Calculate GL totals from parsed GL data
 * 3. Create NEW Excel file (not copy of template)
 * 4. Populate new file with GL calculations + template formatting
 */
@Injectable()
export class CashflowTemplateService {
  private templateDir = path.join(process.cwd(), 'templates');

  /**
   * Load template as reference for structure/formatting
   */
  async loadTemplateAsReference(): Promise<ExcelJS.Workbook> {
    if (!fs.existsSync(this.templateDir)) {
      throw new Error('Templates directory not found');
    }

    const templates = fs
      .readdirSync(this.templateDir)
      .filter((f) => f.includes('Cashflows_Report') || f.includes('cashflow'));

    if (templates.length === 0) {
      throw new Error(
        'No Cashflow template found. Ensure template file exists in templates/ directory.',
      );
    }

    const templateFile = path.join(this.templateDir, templates[0]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templateFile);

    console.log(`✅ Template reference loaded: ${templates[0]}`);
    return workbook;
  }

  /**
   * Extract template structure (headers, formatting, column layout)
   */
  extractTemplateStructure(template: ExcelJS.Workbook): {
    sheetName: string;
    rows: any[];
    columns: any[];
  } {
    const worksheet = template.getWorksheet(1);
    if (!worksheet) {
      throw new Error('No worksheet in template');
    }

    const structure: any = {
      sheetName: worksheet.name || 'Cashflow',
      rows: [],
      columns: worksheet.columns || [],
    };

    console.log(`📋 Extracting template structure from sheet: ${worksheet.name}`);

    // Extract all rows (for reference)
    worksheet.eachRow((row, rowNumber) => {
      structure.rows.push({
        rowNumber,
        values: row.values,
        height: row.height,
      });
    });

    console.log(
      `   Found ${structure.rows.length} rows, ${structure.columns.length} columns`,
    );
    return structure;
  }

  /**
   * Calculate GL data totals by category
   */
  calculateCategoryTotals(
    glData: Map<string, { debit: number; credit: number }>,
  ): GLCategoryData {
    const totals: GLCategoryData = {
      'Thu dự án': 0, // 515.x - Revenue
      'Chi dự án': 0, // 635.x - Expense
      'Tài chính thu nhập': 0, // 81x - Financial income
      'Tài chính chi': 0, // 82x - Financial expense
      'Tiền mặt': 0, // 1111 - Cash
    };

    console.log('🧮 Calculating GL totals by category...');

    for (const [account, amounts] of glData.entries()) {
      console.log(
        `   Account ${account}: Debit=${amounts.debit}, Credit=${amounts.credit}`,
      );

      if (account.startsWith('515')) {
        totals['Thu dự án'] += amounts.debit;
        console.log(`     → "Thu dự án" += ${amounts.debit}`);
      } else if (account.startsWith('635')) {
        totals['Chi dự án'] += amounts.credit;
        console.log(`     → "Chi dự án" += ${amounts.credit}`);
      } else if (account.startsWith('81')) {
        totals['Tài chính thu nhập'] += amounts.debit;
        console.log(`     → "Tài chính thu nhập" += ${amounts.debit}`);
      } else if (account.startsWith('82')) {
        totals['Tài chính chi'] += amounts.credit;
        console.log(`     → "Tài chính chi" += ${amounts.credit}`);
      } else if (account === '1111') {
        totals['Tiền mặt'] += amounts.debit - amounts.credit;
        console.log(`     → "Tiền mặt" += ${amounts.debit - amounts.credit}`);
      }
    }

    console.log('\n✅ Final Category Totals:');
    Object.entries(totals).forEach(([category, value]) => {
      console.log(`   ${category}: ${value.toLocaleString('vi-VN')} VND`);
    });

    return totals;
  }

  /**
   * Create NEW Excel file (not copy of template)
   * Use template structure as reference, populate with GL data
   */
  async createNewCashflowFile(
    templateRef: ExcelJS.Workbook,
    glData: Map<string, { debit: number; credit: number }>,
    year: number,
    month: number,
  ): Promise<ExcelJS.Workbook> {
    // Calculate GL totals
    const categoryTotals = this.calculateCategoryTotals(glData);

    // Extract template structure
    const templateStructure = this.extractTemplateStructure(templateRef);

    // Create NEW workbook (not copy)
    const newWorkbook = new ExcelJS.Workbook();
    const newWorksheet = newWorkbook.addWorksheet(templateStructure.sheetName);

    console.log(
      '\n📝 Creating NEW Cashflow file from template structure...',
    );

    // Copy columns from template
    if (templateStructure.columns && templateStructure.columns.length > 0) {
      newWorksheet.columns = templateStructure.columns.map((col) => ({
        header: col.header,
        width: col.width || 15,
      }));
    }

    // Copy rows from template and fill GL data
    const sourceWorksheet = templateRef.getWorksheet(1);
    if (!sourceWorksheet) {
      throw new Error('Source template has no worksheet');
    }

    let rowCount = 0;
    const dataColumnIndex = month + 1; // Column B=2 (Jan), C=3 (Feb), D=4 (Mar), etc.

    console.log(
      `   Target column for month ${month}: Column ${String.fromCharCode(64 + dataColumnIndex)}`,
    );

    // Copy all rows from template
    sourceWorksheet.eachRow((sourceRow, sourceRowNumber) => {
      const newRow = newWorksheet.getRow(sourceRowNumber);

      // Copy cell values and formatting
      sourceRow.eachCell((sourceCell, colNumber) => {
        const newCell = newRow.getCell(colNumber);

        // Check if this row contains a category name
        const firstCellValue = String(
          sourceRow.getCell(1).value || '',
        ).trim();
        let categoryMatched = false;

        for (const [category, value] of Object.entries(categoryTotals)) {
          if (firstCellValue.includes(category)) {
            // Fill GL data in the target column
            if (colNumber === dataColumnIndex) {
              newCell.value = value;
              newCell.numFmt = '#,##0';
              categoryMatched = true;
              console.log(
                `   ✓ R${sourceRowNumber}C${colNumber}: "${category}" = ${value.toLocaleString('vi-VN')}`,
              );
            } else {
              // Other columns: copy from template
              newCell.value = sourceCell.value;
              newCell.numFmt = sourceCell.numFmt;
            }
            break;
          }
        }

        // Non-category rows: copy from template
        if (!categoryMatched) {
          newCell.value = sourceCell.value;
          newCell.numFmt = sourceCell.numFmt;
        }

        // Copy formatting
        if (sourceCell.font) newCell.font = { ...sourceCell.font };
        if (sourceCell.fill) newCell.fill = { ...sourceCell.fill };
        if (sourceCell.alignment) newCell.alignment = { ...sourceCell.alignment };
        if (sourceCell.border) newCell.border = { ...sourceCell.border };

        newRow.height = sourceRow.height;
      });

      rowCount++;
    });

    console.log(`\n✅ Created new file with ${rowCount} rows`);
    return newWorkbook;
  }

  /**
   * Export new Cashflow file to Excel
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
    console.log(`✅ Exported new Cashflow file: ${outPath}`);
    return outPath;
  }
}
