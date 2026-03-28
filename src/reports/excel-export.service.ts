import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ParticipationRow } from './participation.service';

@Injectable()
export class ExcelExportService {
  /**
   * Export participation report to XLSX
   */
  async exportParticipationReport(
    rows: ParticipationRow[],
    year: number,
    month: number,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Participation Report');

    // Header
    sheet.columns = [
      { header: 'Employee Code', key: 'employeeCode', width: 15 },
      { header: 'Employee Name', key: 'employeeName', width: 25 },
      { header: 'Standard Hours', key: 'standardHours', width: 15 },
      { header: 'Project Hours', key: 'projectHours', width: 15 },
      { header: 'Self-learning Hours', key: 'selfLearningHours', width: 18 },
      { header: 'Project %', key: 'projectPercent', width: 12 },
      { header: 'Self-learning %', key: 'selfLearningPercent', width: 15 },
      { header: 'Alert', key: 'alert', width: 10 },
    ];

    // Style header
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF366092' },
    };

    // Add data rows
    for (const row of rows) {
      sheet.addRow({
        employeeCode: row.employeeId,
        employeeName: row.employeeName,
        standardHours: row.standardHours,
        projectHours: row.projectHours,
        selfLearningHours: row.selfLearningHours,
        projectPercent: `${row.projectPercent}%`,
        selfLearningPercent: `${row.selfLearningPercent}%`,
        alert: row.alert ? '⚠️ YES' : 'No',
      });

      // Highlight alerts
      if (row.alert) {
        const rowIndex = sheet.rowCount;
        sheet.getRow(rowIndex).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFEB3B' }, // Yellow
        };
      }
    }

    // Freeze header row
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Return buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as unknown as Buffer;
  }

  /**
   * Export project breakdown for employee
   */
  async exportProjectBreakdown(
    rows: ParticipationRow[],
    year: number,
    month: number,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Project Breakdown');

    // Header
    sheet.columns = [
      { header: 'Employee Code', key: 'employeeCode', width: 15 },
      { header: 'Employee Name', key: 'employeeName', width: 25 },
      { header: 'Project Code', key: 'projectCode', width: 15 },
      { header: 'Project Name', key: 'projectName', width: 25 },
      { header: 'Hours', key: 'hours', width: 12 },
      { header: 'Percent', key: 'percent', width: 10 },
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF366092' },
    };

    // Add rows
    for (const row of rows) {
      for (const proj of row.projects) {
        sheet.addRow({
          employeeCode: row.employeeId,
          employeeName: row.employeeName,
          projectCode: proj.projectCode,
          projectName: proj.projectName,
          hours: proj.hours,
          percent: `${proj.percent}%`,
        });
      }
    }

    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as unknown as Buffer;
  }
}
