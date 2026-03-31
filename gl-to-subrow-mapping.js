/**
 * Build comprehensive GL → Cashflow Sub-Row Mapping
 * Each GL account code maps to a specific sub-row in cashflow template
 * 
 * Structure:
 * R6: Thu dự án (TOTAL) = SUM(R10:R14)
 *   R10: Thu đầu tư tài chính, tiết kiệm ← 515.3
 *   R11: Thu đầu tư R&D ← 515.5
 *   R12: Thu khác ← 515.2, 711.2
 *   R13: Thu từ khấu trừ thuế CTV ← 711.1
 *   R14: Lãi/lỗ TG ← 515.1, 635.x
 * 
 * R17: Lương dự án (TOTAL) = SUM(R18:R22)
 *   R18-R22: Salary details ← 334.x
 * 
 * etc.
 */

const GLToSubRowMapping = {
  // REVENUE: R10-R14
  '515.3': { row: 10, category: 'Thu đầu tư tài chính, tiết kiệm' },
  '515.5': { row: 11, category: 'Thu đầu tư R&D' },
  '515.2': { row: 12, category: 'Thu khác' },
  '711.2': { row: 12, category: 'Thu khác' },
  '711.1': { row: 13, category: 'Thu từ khấu trừ thuế CTV' },
  '515.1': { row: 14, category: 'Lãi/lỗ TG' },
  '635': { row: 14, category: 'Lãi/lỗ TG' },

  // SALARY: R18-R22
  '334.1': { row: 18, category: 'Lương nhân viên nội bộ' },
  '334.2': { row: 19, category: 'Lương nhân viên thuê ngoài' },
  // R20, R21, R22: reserved for other salary

  // ADMIN: R24-R26
  // Quản lý văn phòng sub-rows
  '6422.2': { row: 24, category: 'Dịch vụ/Điện/Nước' },
  '6422.3': { row: 25, category: 'Mua sắm văn phòng' },
  '6422.4': { row: 26, category: 'Chi phí quản lý' },

  // QA COST: R29-R30
  '154.1': { row: 29, category: 'Chi phí NCTT' },
  '154.2': { row: 30, category: 'Chi phí Vendor' },

  // HR: R32-R33
  '6421.2': { row: 32, category: 'Lương/Thưởng HCNS' },
  // R33: reserved

  // ACCOUNTING: R35-R36
  '6422.6': { row: 35, category: 'Lương bộ phận kế toán' },
  // R36: reserved

  // SALES: R38-R43
  '6421.3': { row: 38, category: 'Lương NV Sales' },
  '6421.4': { row: 39, category: 'Công cụ Sales' },
  '6421.5': { row: 40, category: 'Tiếp khách Sales' },
  '6421.6': { row: 41, category: 'Công tác Sales' },
  '6421.7': { row: 42, category: 'Hội phí tham gia' },
  // R43: reserved

  // MARKETING: R45-R48
  '6421.8': { row: 45, category: 'Công tác Marketing' },
  '6421.9': { row: 46, category: 'Event Marketing' },
  // R47, R48: reserved

  // IT INFRASTRUCTURE: R50-R52
  // (need to identify IT accounts from Danh sách)

  // TAX & INSURANCE: R54-R56
  '821': { row: 54, category: 'Thuế thu nhập' },
  // R55, R56: reserved

  // BONUS: R58-R62
  '334-10': { row: 58, category: 'Thưởng MKT' },
  '334-11': { row: 59, category: 'Thưởng kinh doanh' },
  '334-12': { row: 60, category: 'Thưởng kế toán' },
  '6421-13': { row: 61, category: 'Thưởng MKT' },
  '6421-14': { row: 62, category: 'Thưởng kinh doanh' },
};

module.exports = GLToSubRowMapping;
