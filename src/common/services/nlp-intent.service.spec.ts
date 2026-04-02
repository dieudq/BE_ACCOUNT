import { NlpIntentService } from './nlp-intent.service';

describe('NlpIntentService Fallback Context + RateLimit', () => {
  let service: NlpIntentService;
  const llmMock = {
    generateResponse: jest.fn(),
  };

  beforeEach(() => {
    llmMock.generateResponse.mockRejectedValue(new Error('LLM service unavailable: all providers failed'));
    service = new NlpIntentService(llmMock as any);
  });

  it('should parse relative month for cashflow question when LLM is unavailable', async () => {
    const now = new Date();
    const expectedMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const expectedYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const parsed = await service.parseIntent('Tháng vừa rồi tổng thu chi thế nào?');

    expect(parsed.intent).toBe('query_cashflow_gl');
    expect(parsed.entities.month).toBe(expectedMonth);
    expect(parsed.entities.year).toBe(expectedYear);
  });

  it('should inherit employee context from previous turns for follow-up pronoun text', async () => {
    const context = [
      'Người dùng: Phân tích Nguyễn Văn A tháng 3/2026',
      'Bot: Đã phân tích xong',
    ];

    const parsed = await service.parseIntent('Còn người đó thì sao?', context);

    expect(parsed.intent).toBe('analyze_employee');
    expect(parsed.entities.employeeName).toContain('Nguyễn Văn');
    expect(parsed.entities.month).toBe(3);
    expect(parsed.entities.year).toBe(2026);
  });

  it('should keep cashflow intent for short follow-up text using context memory', async () => {
    const context = [
      'Người dùng: Tổng thu chi cashflow kỳ 2026-01',
      'Bot: Đây là tổng thu chi kỳ 2026-01',
    ];

    const parsed = await service.parseIntent('chi tiết hơn đi', context);

    expect(parsed.intent).toBe('query_cashflow_gl');
    expect(parsed.entities.month).toBe(1);
    expect(parsed.entities.year).toBe(2026);
  });

  it('should extract threshold for at-risk workload query', async () => {
    const parsed = await service.parseIntent('Ai vượt ngưỡng 25h tháng này?');

    expect(parsed.intent).toBe('query_at_risk_employees');
    expect(parsed.entities.threshold).toBe(25);
  });

  it('should parse shorthand month/year format', async () => {
    const parsed = await service.parseIntent('Cho tôi báo cáo workload thg 2/2026');

    expect(parsed.intent).toBe('query_workload_report');
    expect(parsed.entities.month).toBe(2);
    expect(parsed.entities.year).toBe(2026);
  });

  it('should parse quarter expression Q1/2025 correctly', async () => {
    const parsed = await service.parseIntent('Q1/2025 cashflow có gì bất thường?');

    expect(parsed.intent).toBe('query_cashflow_gl');
    expect(parsed.entities.month).toBe(3);
    expect(parsed.entities.year).toBe(2025);
  });
});
