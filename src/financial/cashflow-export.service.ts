import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class CashflowExportService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate Cashflow Report by aggregating GL accounts
   */
  async generateCashflowReport(year: number, month: number) {
    // Get all GL entries for the period
    const glEntries = await this.prisma.generalLedger.findMany({
      include: {
        account: true,
        period: true,
      },
      where: {
        period: {
          code: `${year}-${String(month).padStart(2, '0')}`,
        },
      },
    });

    if (glEntries.length === 0) {
      throw new Error(`No GL data found for ${month}/${year}`);
    }

    // Aggregate by account code
    const accountMap = new Map<string, { debit: number; credit: number }>();

    glEntries.forEach((entry) => {
      const code = entry.account.accountCode;
      const current = accountMap.get(code) || { debit: 0, credit: 0 };
      current.debit += Number(entry.debitAmount || 0);
      current.credit += Number(entry.creditAmount || 0);
      accountMap.set(code, current);
    });

    // Map GL accounts to Cashflow categories
    const cashflowData = this.mapGLToCashflow(accountMap);

    return {
      year,
      month,
      period: `${month}/${year}`,
      glAccounts: Object.fromEntries(accountMap),
      cashflowData,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Map GL accounts to Cashflow report categories
   * Mapping rules:
   *   515.x (Revenue) → Thu dự án (Project Income)
   *   635.x (Direct Costs) → Chi dự án (Project Expense)
   *   1111 (Cash) → Dòng tiền từ hoạt động (Operating Cash)
   */
  private mapGLToCashflow(
    accountMap: Map<string, { debit: number; credit: number }>,
  ) {
    const data = {
      thuDuAn: 0, // Project revenue (515.1+)
      chiDuAn: 0, // Project expense (635.1+)
      taiChinhThuNhap: 0, // Financial income
      taiChinhChi: 0, // Financial expense
      tienMat: 0, // Cash balance
      noTien: 0, // Receivables
    };

    accountMap.forEach((value, code) => {
      // Revenue accounts (515.x)
      if (code.startsWith('515')) {
        data.thuDuAn += value.credit; // Credit side for revenue
      }
      // Project expense accounts (635.x)
      else if (code.startsWith('635')) {
        data.chiDuAn += value.debit; // Debit side for expense
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
   * Export Cashflow to Excel file
   */
  async exportToExcel(year: number, month: number): Promise<string> {
    const report = await this.generateCashflowReport(year, month);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cashflow');

    // Header
    ws.mergeCells('A1:D1');
    ws.getCell('A1').value = `BẢNG THEO DÕI DÒNG TIỀN - ${month}/${year}`;
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
    const data = report.cashflowData;

    // Operating activities
    ws.getCell(`A${row}`).value = 'I. HOẠT ĐỘNG KINH DOANH';
    ws.getCell(`A${row}`).font = { bold: true };
    row++;

    ws.getCell(`A${row}`).value = '1. Thu dự án';
    ws.getCell(`B${row}`).value = data.thuDuAn;
    ws.getCell(`B${row}`).numFmt = '#,##0.00';
    row++;

    ws.getCell(`A${row}`).value = '2. Chi dự án';
    ws.getCell(`B${row}`).value = data.chiDuAn;
    ws.getCell(`B${row}`).numFmt = '#,##0.00';
    row++;

    const netOperating = data.thuDuAn - data.chiDuAn;
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
    ws.getCell(`B${row}`).value = data.taiChinhThuNhap;
    ws.getCell(`B${row}`).numFmt = '#,##0.00';
    row++;

    ws.getCell(`A${row}`).value = '2. Chi tài chính';
    ws.getCell(`B${row}`).value = data.taiChinhChi;
    ws.getCell(`B${row}`).numFmt = '#,##0.00';
    row++;

    const netFinancial = data.taiChinhThuNhap - data.taiChinhChi;
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
    ws.getCell(`B${row}`).value = data.tienMat;
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

    const filename = `cashflow_${year}_${String(month).padStart(2, '0')}_${Date.now()}.xlsx`;
    const filepath = path.join(outputDir, filename);

    await wb.xlsx.writeFile(filepath);
    console.log(`✅ Cashflow exported: ${filepath}`);

    return filepath;
  }
}
