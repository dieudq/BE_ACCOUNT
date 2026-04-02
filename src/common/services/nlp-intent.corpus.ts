import { IntentType } from './nlp-intent.service';

export type TemporalExpectation = 'current' | 'lastMonth';

export interface CorpusExpected {
  intent: IntentType;
  month?: number;
  year?: number;
  temporal?: TemporalExpectation;
  threshold?: number;
  employeeNameIncludes?: string;
}

export interface CorpusCase {
  id: string;
  message: string;
  context?: string[];
  tags: string[];
  expected: CorpusExpected;
}

interface Period {
  month: number;
  year: number;
}

const PERIODS: Period[] = [
  { month: 1, year: 2026 },
  { month: 2, year: 2026 },
  { month: 3, year: 2026 },
  { month: 11, year: 2025 },
];

const EMPLOYEES = [
  'Nguyen Van An',
  'Tran Thi Bich',
  'Le Quoc Bao',
  'Pham Minh Tri',
  'Doan Ngoc Ha',
  'Bui Thi Lan',
  'Dang Gia Huy',
  'Vu Minh Chau',
  'Hoang Kim Oanh',
  'Nguyen Hai Dang',
];

function mm(month: number): string {
  return String(month).padStart(2, '0');
}

function periodTexts(period: Period) {
  return {
    slash: `${period.month}/${period.year}`,
    thg: `thg ${period.month}/${period.year}`,
    iso: `${period.year}-${mm(period.month)}`,
    mDashY: `${period.month}-${period.year}`,
    ySpaceM: `${period.year} ${period.month}`,
  };
}

export function buildNlpFallbackCorpus(): CorpusCase[] {
  const corpus: CorpusCase[] = [];
  let idCounter = 1;

  const push = (
    message: string,
    expected: CorpusExpected,
    tags: string[],
    context?: string[],
  ) => {
    corpus.push({
      id: `C${String(idCounter++).padStart(3, '0')}`,
      message,
      expected,
      tags,
      context,
    });
  };

  // 1) Workload report corpus (48 cases)
  const workloadTemplates = [
    (t: ReturnType<typeof periodTexts>) => `Bao cao workload thang ${t.slash}`,
    (t: ReturnType<typeof periodTexts>) => `bao cao workload ${t.thg}`,
    (t: ReturnType<typeof periodTexts>) => `Cho toi thong ke bang cong ${t.slash}`,
    (t: ReturnType<typeof periodTexts>) => `xem gio log ca team ${t.thg}`,
    (t: ReturnType<typeof periodTexts>) => `workload team ky ${t.iso}`,
    (t: ReturnType<typeof periodTexts>) => `tong hop nhan su ${t.slash}`,
    (t: ReturnType<typeof periodTexts>) => `cho xem tham gia du an thang ${t.slash}`,
    (t: ReturnType<typeof periodTexts>) => `thong ke nhan su thang ${t.slash}`,
    (t: ReturnType<typeof periodTexts>) => `bc workload ${t.thg}`,
    (t: ReturnType<typeof periodTexts>) => `workload ${t.ySpaceM}`,
    (t: ReturnType<typeof periodTexts>) => `bang cong toan team ${t.mDashY}`,
    (t: ReturnType<typeof periodTexts>) => `thong ke ca team t ${t.slash}`,
  ];

  for (const period of PERIODS) {
    const text = periodTexts(period);
    for (const makeMessage of workloadTemplates) {
      push(
        makeMessage(text),
        { intent: 'query_workload_report', month: period.month, year: period.year },
        ['workload', 'team'],
      );
    }
  }

  // 2) At-risk corpus (32 cases)
  const thresholds = [20, 25, 30, 35];
  for (const period of PERIODS) {
    const text = periodTexts(period);
    for (const th of thresholds) {
      push(
        `Ai vuot nguong ${th}h thang ${text.slash}`,
        { intent: 'query_at_risk_employees', threshold: th, month: period.month, year: period.year },
        ['workload', 'at-risk', 'threshold'],
      );
      push(
        `canh bao self learning > ${th} gio ${text.iso}`,
        { intent: 'query_at_risk_employees', threshold: th, month: period.month, year: period.year },
        ['workload', 'at-risk', 'threshold'],
      );
    }
  }

  // 3) Analyze employee corpus (40 cases)
  for (let i = 0; i < EMPLOYEES.length; i++) {
    const employee = EMPLOYEES[i];
    const period = PERIODS[i % PERIODS.length];
    const text = periodTexts(period);

    push(
      `Phan tich ${employee} thang ${text.slash}`,
      {
        intent: 'analyze_employee',
        employeeNameIncludes: employee,
        month: period.month,
        year: period.year,
      },
      ['workload', 'employee'],
    );

    push(
      `xem gio cua ${employee} ${text.iso}`,
      {
        intent: 'analyze_employee',
        employeeNameIncludes: employee,
        month: period.month,
        year: period.year,
      },
      ['workload', 'employee'],
    );

    push(
      `workload cua ${employee} ${text.thg}`,
      {
        intent: 'analyze_employee',
        employeeNameIncludes: employee,
        month: period.month,
        year: period.year,
      },
      ['workload', 'employee'],
    );

    push(
      `analyze ${employee} ${text.slash}`,
      {
        intent: 'analyze_employee',
        employeeNameIncludes: employee,
        month: period.month,
        year: period.year,
      },
      ['workload', 'employee'],
    );
  }

  // 4) Context follow-up employee corpus (10 cases)
  for (const employee of EMPLOYEES) {
    push(
      'Con nguoi do thi sao?',
      {
        intent: 'analyze_employee',
        employeeNameIncludes: employee,
        month: 3,
        year: 2026,
      },
      ['context', 'employee-follow-up'],
      [
        `Nguoi dung: Phan tich ${employee} thang 3/2026`,
        'Bot: Da phan tich xong roi',
      ],
    );
  }

  // 5) Cashflow explicit corpus (48 cases)
  const cashflowTemplates = [
    (t: ReturnType<typeof periodTexts>) => `Tong thu chi thang ${t.slash} la bao nhieu`,
    (t: ReturnType<typeof periodTexts>) => `tong thu chi ${t.thg}`,
    (t: ReturnType<typeof periodTexts>) => `dong tien rong ky ${t.iso}`,
    (t: ReturnType<typeof periodTexts>) => `co cau thu chi ${t.slash}`,
    (t: ReturnType<typeof periodTexts>) => `breakdown nhom thu thang ${t.slash}`,
    (t: ReturnType<typeof periodTexts>) => `nhom chi ${t.thg}`,
    (t: ReturnType<typeof periodTexts>) => `cashflow ${t.iso} co gi bat thuong`,
    (t: ReturnType<typeof periodTexts>) => `thu/chi ky ${t.iso}`,
    (t: ReturnType<typeof periodTexts>) => `vi sao dong tien am thang ${t.slash}`,
    (t: ReturnType<typeof periodTexts>) => `bao cao dong tien ${t.mDashY}`,
    (t: ReturnType<typeof periodTexts>) => `lai lo dong tien ${t.slash}`,
    (t: ReturnType<typeof periodTexts>) => `tham hut dong tien ${t.slash}`,
  ];

  for (const period of PERIODS) {
    const text = periodTexts(period);
    for (const makeMessage of cashflowTemplates) {
      push(
        makeMessage(text),
        { intent: 'query_cashflow_gl', month: period.month, year: period.year },
        ['cashflow'],
      );
    }
  }

  // 6) Cashflow relative/context corpus (16 cases)
  const relativeCashflow: Array<{ message: string; temporal: TemporalExpectation }> = [
    { message: 'Thang vua roi tong thu chi the nao', temporal: 'lastMonth' },
    { message: 'thang truoc dong tien rong bao nhieu', temporal: 'lastMonth' },
    { message: 'thang nay co cau thu chi ra sao', temporal: 'current' },
    { message: 'ky nay tong thu chi?', temporal: 'current' },
    { message: 'this month cashflow net la bao nhieu', temporal: 'current' },
    { message: 'last month tong thu chi co am khong', temporal: 'lastMonth' },
  ];

  for (const item of relativeCashflow) {
    push(
      item.message,
      { intent: 'query_cashflow_gl', temporal: item.temporal },
      ['cashflow', 'relative-time'],
    );
  }

  const quarterCashflow = [
    { message: 'Q1/2025 cashflow co gi bat thuong', month: 3, year: 2025 },
    { message: 'q2 2026 dong tien rong the nao', month: 6, year: 2026 },
    { message: 'quy 3 nam 2025 nhom chi bien dong ra sao', month: 9, year: 2025 },
    { message: 'q4/2024 tong thu chi', month: 12, year: 2024 },
  ];

  for (const item of quarterCashflow) {
    push(
      item.message,
      { intent: 'query_cashflow_gl', month: item.month, year: item.year },
      ['cashflow', 'quarter'],
    );
  }

  for (const period of PERIODS) {
    const text = periodTexts(period);
    push(
      'chi tiet hon di',
      { intent: 'query_cashflow_gl', month: period.month, year: period.year },
      ['context', 'cashflow-follow-up'],
      [
        `Nguoi dung: Tong thu chi cashflow ky ${text.iso}`,
        `Bot: Day la tong thu chi ky ${text.iso}`,
      ],
    );
    push(
      'breakdown them giup toi',
      { intent: 'query_cashflow_gl', month: period.month, year: period.year },
      ['context', 'cashflow-follow-up'],
      [
        `Nguoi dung: dong tien rong ky ${text.iso}`,
        `Bot: Da tong hop dong tien ky ${text.iso}`,
      ],
    );
  }

  // 7) Download report corpus (10 cases)
  push('xuat file excel thang 3/2026', { intent: 'download_report', month: 3, year: 2026 }, ['download']);
  push('tai file bao cao thg 2/2026', { intent: 'download_report', month: 2, year: 2026 }, ['download']);
  push('download report 2026-01', { intent: 'download_report', month: 1, year: 2026 }, ['download']);
  push('gui file excel ky 2025-11', { intent: 'download_report', month: 11, year: 2025 }, ['download']);
  push('xuat bao cao excel', { intent: 'download_report' }, ['download']);
  push('cho toi file excel', { intent: 'download_report' }, ['download']);
  push('gui file report', { intent: 'download_report' }, ['download']);
  push('xuat file ngay bay gio', { intent: 'download_report' }, ['download']);
  push('download file bao cao', { intent: 'download_report' }, ['download']);
  push('gui toi 1 file excel nhe', { intent: 'download_report' }, ['download']);

  // 8) Sync workload corpus (10 cases)
  push('dong bo du lieu thang 3/2026', { intent: 'sync_workload', month: 3, year: 2026 }, ['sync']);
  push('sync du lieu thg 2/2026', { intent: 'sync_workload', month: 2, year: 2026 }, ['sync']);
  push('refresh du lieu ky 2026-01', { intent: 'sync_workload', month: 1, year: 2026 }, ['sync']);
  push('lam moi du lieu 2025-11', { intent: 'sync_workload', month: 11, year: 2025 }, ['sync']);
  push('dong bo du lieu thang nay', { intent: 'sync_workload', temporal: 'current' }, ['sync', 'relative-time']);
  push('sync du lieu thang truoc', { intent: 'sync_workload', temporal: 'lastMonth' }, ['sync', 'relative-time']);
  push('refresh du lieu current month', { intent: 'sync_workload', temporal: 'current' }, ['sync', 'relative-time']);
  push('sync data previous month', { intent: 'sync_workload', temporal: 'lastMonth' }, ['sync', 'relative-time']);
  push('cap nhat du lieu thang 1/2026', { intent: 'sync_workload', month: 1, year: 2026 }, ['sync']);
  push('lam moi du lieu thg 3/2026', { intent: 'sync_workload', month: 3, year: 2026 }, ['sync']);

  // 9) General chat corpus (8 cases)
  push('xin chao', { intent: 'general_chat' }, ['general']);
  push('hello bot', { intent: 'general_chat' }, ['general']);
  push('cam on ban nhe', { intent: 'general_chat' }, ['general']);
  push('toi muon noi chuyen thoi', { intent: 'general_chat' }, ['general']);
  push('hom nay ban khoe khong', { intent: 'general_chat' }, ['general']);
  push('ok nhe', { intent: 'general_chat' }, ['general']);
  push('rat tot', { intent: 'general_chat' }, ['general']);
  push('chao tam biet', { intent: 'general_chat' }, ['general']);

  return corpus;
}
