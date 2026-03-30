import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';
import { GLFileParserService, ParsedGLData } from './gl-file-parser.service';
import { CashflowExportService } from './cashflow-export.service';

@Injectable()
export class GLFileProcessorService {
  constructor(
    private glParser: GLFileParserService,
    private cashflowExport: CashflowExportService,
  ) {}

  /**
   * Process uploaded GL file → Parse → Calculate Cashflow → Export Excel
   */
  async processGLFileAndGenerateCashflow(filePath: string): Promise<string> {
    try {
      // Step 1: Parse GL file
      console.log('📖 Parsing GL file...');
      const glData = await this.glParser.parseGLFile(filePath);

      // Step 2: Map GL to Cashflow categories
      console.log('🧮 Mapping GL to Cashflow...');
      const cashflowData = this.mapGLToCashflow(glData.accounts);

      // Step 3: Generate Excel file
      console.log('📊 Generating Cashflow Excel...');
      const outputPath = await this.generateCashflowExcel(
        glData,
        cashflowData,
      );

      console.log(`✅ Processing complete: ${outputPath}`);
      return outputPath;
    } catch (err) {
      console.error('❌ Error processing GL file:', err);
      throw err;
    }
  }

  /**
   * Map GL accounts to Cashflow categories
   */
  private mapGLToCashflow(
    accounts: Map<string, { debit: number; credit: number }>,
  ) {
    const data = {
      thuDuAn: 0, // Project revenue (515.x)
      chiDuAn: 0, // Project expense (635.x)
      taiChinhThuNhap: 0, // Financial income (81x)
      taiChinhChi: 0, // Financial expense (82x)
      tienMat: 0, // Cash balance (1111)
      noTien: 0, // Receivables (1112)
    };

    accounts.forEach((value, code) => {
      // Revenue accounts (515.x)
      if (code.startsWith('515')) {
        data.thuDuAn += value.credit;
      }
      // Project expense accounts (635.x)
      else if (code.startsWith('635')) {
        data.chiDuAn += value.debit;
      }
      // Financial income (81x)
      else if (code.startsWith('81')) {
        data.taiChinhThuNhap += value.credit;
      }
      // Financial expense (82x)
      else if (code.startsWith('82')) {
        data.taiChinhChi += value.debit;
      }
      // Cash accounts (1111)
      else if (code === '1111') {
        data.tienMat = value.debit - value.credit;
      }
      // Receivables (1112)
      else if (code === '1112') {
        data.noTien = value.debit - value.credit;
      }
    });

    return data;
  }

  /**
   * Generate Cashflow Excel from parsed GL data
   */
  private async generateCashflowExcel(
    glData: ParsedGLData,
    cashflowData: any,
  ): Promise<string> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cashflow');

    // Header
    ws.mergeCells('A1:D1');
    ws.getCell('A1').value = `BẢNG THEO DÕI DÒNG TIỀN - ${glData.period}`;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A1').alignment = { horizontal: 'center' };

    // Column headers
    ws.getCell('A3').value = 'Chỉ tiêu';
    ws.getCell('B3').value = 'Số tiền';
    ws.getCell('C3').value = '%';
    ws.getCell('D3').value = 'Ghi chú';

    ['A3', 'B3', 'C3', 'D3'].forEach((cell) => {
      ws.getCell(cell).font = { bold: true };
      ws.getCell(cell).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' },
      };
    });

    // Data rows
    let row = 4;

    // Operating activities
    ws.getCell(`A${row}`).value = 'I. HOẠT ĐỘNG KINH DOANH';
    ws.getCell(`A${row}`).font = { bold: true };
    row++;

    ws.getCell(`A${row}`).value = '1. Thu dự án';
    ws.getCell(`B${row}`).value = cashflowData.thuDuAn;
    ws.getCell(`B${row}`).numFmt = '#,##0.00';
    row++;

    ws.getCell(`A${row}`).value = '2. Chi dự án';
    ws.getCell(`B${row}`).value = cashflowData.chiDuAn;
    ws.getCell(`B${row}`).numFmt = '#,##0.00';
    row++;

    const netOperating = cashflowData.thuDuAn - cashflowData.chiDuAn;
    ws.getCell(`A${row}`).value = 'Lãi ròng từ hoạt động';
    ws.getCell(`B${row}`).value = netOperating;
    ws.getCell(`B${row}`).font = { bold: true };
    ws.getCell(`B${row}`).numFmt = '#,##0.00';
    row++;

    // Financial activities
    row++;
    ws.getCell(`A${row}`).value = 'II. HOẠT ĐỘNG TÀI CHÍNH';
    ws.getCell(`A${row}`).font = { bold: true };
    row++;

    ws.getCell(`A${row}`).value = '1. Thu tài chính';
    ws.getCell(`B${row}`).value = cashflowData.taiChinhThuNhap;
    ws.getCell(`B${row}`).numFmt = '#,##0.00';
    row++;

    ws.getCell(`A${row}`).value = '2. Chi tài chính';
    ws.getCell(`B${row}`).value = cashflowData.taiChinhChi;
    ws.getCell(`B${row}`).numFmt = '#,##0.00';
    row++;

    const netFinancial = cashflowData.taiChinhThuNhap - cashflowData.taiChinhChi;
    ws.getCell(`A${row}`).value = 'Lãi ròng từ tài chính';
    ws.getCell(`B${row}`).value = netFinancial;
    ws.getCell(`B${row}`).font = { bold: true };
    ws.getCell(`B${row}`).numFmt = '#,##0.00';
    row++;

    // Cash position
    row++;
    ws.getCell(`A${row}`).value = 'III. TIỀN MẶT';
    ws.getCell(`A${row}`).font = { bold: true };
    row++;

    ws.getCell(`A${row}`).value = 'Dòng tiền ròng';
    ws.getCell(`B${row}`).value = netOperating + netFinancial;
    ws.getCell(`B${row}`).font = { bold: true };
    ws.getCell(`B${row}`).numFmt = '#,##0.00';
    row++;

    ws.getCell(`A${row}`).value = 'Tiền mặt đầu kỳ';
    ws.getCell(`B${row}`).value = 0;
    ws.getCell(`B${row}`).numFmt = '#,##0.00';
    row++;

    ws.getCell(`A${row}`).value = 'Tiền mặt cuối kỳ';
    ws.getCell(`B${row}`).value = cashflowData.tienMat;
    ws.getCell(`B${row}`).font = { bold: true };
    ws.getCell(`B${row}`).numFmt = '#,##0.00';

    // Column widths
    ws.getColumn('A').width = 30;
    ws.getColumn('B').width = 15;
    ws.getColumn('C').width = 10;
    ws.getColumn('D').width = 20;

    // Save file
    const outputDir = path.join(process.cwd(), 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = `cashflow_${glData.period}_${Date.now()}.xlsx`;
    const filepath = path.join(outputDir, filename);

    await wb.xlsx.writeFile(filepath);
    console.log(`✅ Cashflow Excel saved: ${filepath}`);

    return filepath;
  }
}
