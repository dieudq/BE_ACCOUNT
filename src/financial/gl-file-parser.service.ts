import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

export interface GLAccountRecord {
  date: Date;
  voucherDate: Date;
  voucherNo: string;
  description: string;
  counterAccount: string;
  debitAmount: number;
  creditAmount: number;
}

export interface ParsedGLData {
  sheetName: string;
  accounts: Map<string, { debit: number; credit: number }>;
  records: GLAccountRecord[];
  period: string;
  currency: string;
}

@Injectable()
export class GLFileParserService {
  /**
   * Parse GL Account Detail Excel file
   * Expected columns: Ngày hạch toán | Ngày chứng từ | Số chứng từ | Diễn giải | TK đối ứng | Phát sinh Nợ | Phát sinh Có
   */
  async parseGLFile(filePath: string): Promise<ParsedGLData> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('No worksheet found in Excel file');
    }

    const data: ParsedGLData = {
      sheetName: worksheet.name,
      accounts: new Map(),
      records: [],
      period: '',
      currency: 'VND',
    };

    let headerRow = 0;
    let currentAccount = '';

    // Scan rows to find headers and extract data
    worksheet.eachRow((row, rowNumber) => {
      const values = row.values as (string | number | Date | null)[];

      // Skip empty rows
      if (!values || values.length === 0) return;

      // Look for header row (contains "Ngày hạch toán")
      if (!headerRow && values.some((v) => String(v).includes('Ngày hạch toán'))) {
        headerRow = rowNumber;
        return;
      }

      // Extract period info from header rows (e.g., "Loại tiền: <<Tổng hợp>>, Tháng 1 năm 2026")
      if (!data.period && values.some((v) => String(v).includes('Tháng'))) {
        const periodStr = String(values[1] || values[2]);
        const match = periodStr.match(/Tháng (\d+) năm (\d+)/);
        if (match) {
          data.period = `${match[2]}-${String(match[1]).padStart(2, '0')}`;
        }
      }

      // Skip rows before header
      if (!headerRow || rowNumber <= headerRow) return;

      // Extract account headers (e.g., "Tài khoản: 1111")
      if (values[1] && String(values[1]).includes('Tài khoản:')) {
        const match = String(values[1]).match(/Tài khoản:\s*(\d+[.\d]*)/);
        if (match) {
          currentAccount = match[1];
          if (!data.accounts.has(currentAccount)) {
            data.accounts.set(currentAccount, { debit: 0, credit: 0 });
          }
        }
        return;
      }

      // Extract GL transaction data
      if (currentAccount && values.length >= 7) {
        const dateVal = values[1];
        const voucherDateVal = values[2];
        const voucherNo = String(values[3] || '');
        const description = String(values[4] || '');
        const counterAccount = String(values[5] || '');
        const debitStr = String(values[6] || '0');
        const creditStr = String(values[7] || '0');

        // Parse amounts (remove commas, convert to number)
        const debitAmount = this.parseAmount(debitStr);
        const creditAmount = this.parseAmount(creditStr);

        if (debitAmount > 0 || creditAmount > 0) {
          const record: GLAccountRecord = {
            date: this.parseDate(dateVal),
            voucherDate: this.parseDate(voucherDateVal),
            voucherNo,
            description,
            counterAccount,
            debitAmount,
            creditAmount,
          };

          data.records.push(record);

          // Aggregate by account
          const account = data.accounts.get(currentAccount);
          if (account) {
            account.debit += debitAmount;
            account.credit += creditAmount;
          }
        }
      }
    });

    console.log(`✅ Parsed GL file: ${data.sheetName}`);
    console.log(`   Period: ${data.period}`);
    console.log(`   Total accounts found: ${data.accounts.size}`);
    console.log(`   Accounts:`);
    data.accounts.forEach((amounts, account) => {
      console.log(
        `     ${account}: Debit=${amounts.debit.toLocaleString('vi-VN')}, Credit=${amounts.credit.toLocaleString('vi-VN')}`,
      );
    });
    return data;
  }

  /**
   * Parse amount from string (handles Vietnamese number format)
   */
  private parseAmount(value: string | number | null): number {
    if (!value) return 0;

    const str = String(value).trim();
    if (!str || str === '-') return 0;

    // Remove comma thousands separator, convert to number
    const cleaned = str.replace(/,/g, '').replace(/\./g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Parse date from various formats
   */
  private parseDate(value: string | number | Date | null): Date {
    if (!value) return new Date();

    if (value instanceof Date) {
      return value;
    }

    // Try to parse string
    const str = String(value).trim();
    if (!str) return new Date();

    // Try standard date parsing
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    // Fallback to today
    return new Date();
  }

  /**
   * Export parsed data for testing
   */
  async exportParsedData(data: ParsedGLData, outputPath: string): Promise<void> {
    const report = {
      sheetName: data.sheetName,
      period: data.period,
      totalAccounts: data.accounts.size,
      totalRecords: data.records.length,
      accounts: Object.fromEntries(data.accounts),
      sampleRecords: data.records.slice(0, 5),
    };

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`📄 Parsed data exported to: ${outputPath}`);
  }
}
