import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ParticipationRow } from './participation.service';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF366092' },
};

const ALERT_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFEB3B' },
};

@Injectable()
export class ExcelExportService {
  /**
   * Export participation report with dynamic project columns.
   * Each unique project across all employees gets its own "% PROJECT_KEY" column.
   */
  async exportParticipationReport(
    rows: ParticipationRow[],
    year: number,
    month: number,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'WorkMate AI';
    workbook.created = new Date();

    // ── Sheet 1: Summary ────────────────────────────────────────────────────
    const summarySheet = workbook.addWorksheet('Summary');

    // Collect all unique projects (ordered by total hours desc)
    const projectTotals = new Map<string, { name: string; totalHours: number }>();
    for (const row of rows) {
      for (const proj of row.projects) {
        const existing = projectTotals.get(proj.projectCode) ?? {
          name: proj.projectName,
          totalHours: 0,
        };
        existing.totalHours += proj.hours;
        projectTotals.set(proj.projectCode, existing);
      }
    }

    const allProjects = Array.from(projectTotals.entries())
      .sort((a, b) => b[1].totalHours - a[1].totalHours)
      .map(([code, data]) => ({ code, name: data.name }));

    // Fixed columns
    const fixedColumns: Partial<ExcelJS.Column>[] = [
      { header: 'Mã NV', key: 'employeeCode', width: 14 },
      { header: 'Họ tên', key: 'employeeName', width: 28 },
      { header: 'Giờ chuẩn', key: 'standardHours', width: 12 },
      { header: 'Giờ đã log', key: 'projectHours', width: 12 },
      { header: 'Self-learning (h)', key: 'selfLearningHours', width: 18 },
      { header: 'Self-learning (%)', key: 'selfLearningPercent', width: 18 },
      { header: 'Cảnh báo', key: 'alert', width: 12 },
    ];

    // Dynamic project columns
    const projectColumns: Partial<ExcelJS.Column>[] = allProjects.map((p) => ({
      header: `% ${p.code}`,
      key: `proj_${p.code}`,
      width: Math.max(10, p.code.length + 4),
    }));

    summarySheet.columns = [...fixedColumns, ...projectColumns];

    // Style header
    const headerRow = summarySheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = HEADER_FILL;
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    // Add title row above header
    summarySheet.spliceRows(1, 0, [
      `Báo cáo tỷ lệ tham gia dự án — ${month}/${year}`,
      ...new Array(fixedColumns.length + projectColumns.length - 1).fill(''),
    ]);
    summarySheet.mergeCells(1, 1, 1, fixedColumns.length + projectColumns.length);
    const titleRow = summarySheet.getRow(1);
    titleRow.font = { bold: true, size: 13, color: { argb: 'FF1F3864' } };
    titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
    titleRow.height = 24;

    // Data rows (start from row 3 after title + header)
    for (const row of rows) {
      const projectPercentByCode = new Map(
        row.projects.map((p) => [p.projectCode, p.percent]),
      );

      const dataRow: Record<string, any> = {
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        standardHours: row.standardHours,
        projectHours: row.projectHours,
        selfLearningHours: row.selfLearningHours,
        selfLearningPercent: row.selfLearningPercent,
        alert: row.alert ? '⚠️ Vượt ngưỡng' : '✅ OK',
      };

      for (const p of allProjects) {
        dataRow[`proj_${p.code}`] = projectPercentByCode.get(p.code) ?? 0;
      }

      summarySheet.addRow(dataRow);

      if (row.alert) {
        const lastRow = summarySheet.getRow(summarySheet.rowCount);
        lastRow.fill = ALERT_FILL;
        lastRow.font = { bold: true };
      }
    }

    // Freeze header rows
    summarySheet.views = [{ state: 'frozen', ySplit: 2 }];

    // Auto border on all cells
    summarySheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    });

    // ── Sheet 2: Project Breakdown ──────────────────────────────────────────
    const breakdownSheet = workbook.addWorksheet('Chi tiết dự án');
    breakdownSheet.columns = [
      { header: 'Mã NV', key: 'employeeCode', width: 14 },
      { header: 'Họ tên', key: 'employeeName', width: 28 },
      { header: 'Mã dự án', key: 'projectCode', width: 14 },
      { header: 'Tên dự án', key: 'projectName', width: 30 },
      { header: 'Giờ log', key: 'hours', width: 12 },
      { header: '% tham gia', key: 'percent', width: 14 },
    ];

    const bdHeader = breakdownSheet.getRow(1);
    bdHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    bdHeader.fill = HEADER_FILL;

    for (const row of rows) {
      if (row.projects.length === 0) {
        breakdownSheet.addRow({
          employeeCode: row.employeeCode,
          employeeName: row.employeeName,
          projectCode: '—',
          projectName: 'Không có dự án',
          hours: 0,
          percent: 0,
        });
      } else {
        for (const proj of row.projects) {
          breakdownSheet.addRow({
            employeeCode: row.employeeCode,
            employeeName: row.employeeName,
            projectCode: proj.projectCode,
            projectName: proj.projectName,
            hours: proj.hours,
            percent: proj.percent,
          });
        }
      }
    }

    breakdownSheet.views = [{ state: 'frozen', ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
