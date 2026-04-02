import * as fs from 'fs';
import * as path from 'path';
import { NlpIntentService, ParsedIntent } from './nlp-intent.service';
import { buildNlpFallbackCorpus, CorpusCase } from './nlp-intent.corpus';

function normalizeText(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

function getExpectedTemporal(c: CorpusCase): { month?: number; year?: number } {
  if (c.expected.month || c.expected.year) {
    return { month: c.expected.month, year: c.expected.year };
  }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  if (c.expected.temporal === 'current') {
    return { month: currentMonth, year: currentYear };
  }

  if (c.expected.temporal === 'lastMonth') {
    if (currentMonth === 1) {
      return { month: 12, year: currentYear - 1 };
    }
    return { month: currentMonth - 1, year: currentYear };
  }

  return {};
}

function evaluateCase(testCase: CorpusCase, parsed: ParsedIntent) {
  const reasons: string[] = [];

  const intentOk = parsed.intent === testCase.expected.intent;
  if (!intentOk) {
    reasons.push(`intent expected=${testCase.expected.intent} actual=${parsed.intent}`);
  }

  const expectedTemporal = getExpectedTemporal(testCase);
  const hasTemporalExpectation =
    expectedTemporal.month !== undefined || expectedTemporal.year !== undefined;

  let temporalOk = true;
  if (hasTemporalExpectation) {
    if (
      expectedTemporal.month !== undefined &&
      parsed.entities.month !== expectedTemporal.month
    ) {
      temporalOk = false;
      reasons.push(
        `month expected=${expectedTemporal.month} actual=${parsed.entities.month ?? 'null'}`,
      );
    }

    if (
      expectedTemporal.year !== undefined &&
      parsed.entities.year !== expectedTemporal.year
    ) {
      temporalOk = false;
      reasons.push(
        `year expected=${expectedTemporal.year} actual=${parsed.entities.year ?? 'null'}`,
      );
    }
  }

  let employeeOk = true;
  if (testCase.expected.employeeNameIncludes) {
    const expectedName = normalizeText(testCase.expected.employeeNameIncludes);
    const actualName = normalizeText(parsed.entities.employeeName);
    employeeOk = actualName.includes(expectedName);

    if (!employeeOk) {
      reasons.push(
        `employee expected~=${testCase.expected.employeeNameIncludes} actual=${parsed.entities.employeeName ?? 'null'}`,
      );
    }
  }

  let thresholdOk = true;
  if (testCase.expected.threshold !== undefined) {
    thresholdOk = parsed.entities.threshold === testCase.expected.threshold;
    if (!thresholdOk) {
      reasons.push(
        `threshold expected=${testCase.expected.threshold} actual=${parsed.entities.threshold ?? 'null'}`,
      );
    }
  }

  const entityOk = employeeOk && thresholdOk;

  return {
    intentOk,
    temporalOk,
    entityOk,
    hasTemporalExpectation,
    hasEntityExpectation:
      testCase.expected.employeeNameIncludes !== undefined ||
      testCase.expected.threshold !== undefined,
    reasons,
  };
}

describe('NlpIntentService Fallback Corpus Scoring', () => {
  let service: NlpIntentService;
  const llmMock = {
    generateResponse: jest.fn(),
  };

  beforeEach(() => {
    llmMock.generateResponse.mockRejectedValue(
      new Error('LLM service unavailable: all providers failed'),
    );
    service = new NlpIntentService(llmMock as any);
  });

  it('should keep fallback quality stable on 150-300 corpus and emit scoring report', async () => {
    const corpus = buildNlpFallbackCorpus();

    expect(corpus.length).toBeGreaterThanOrEqual(150);
    expect(corpus.length).toBeLessThanOrEqual(300);

    const perIntent = new Map<string, { total: number; correct: number }>();
    const failures: Array<{
      id: string;
      message: string;
      tags: string[];
      expectedIntent: string;
      actualIntent: string;
      reasons: string[];
    }> = [];

    let intentPass = 0;
    let temporalPass = 0;
    let temporalTotal = 0;
    let entityPass = 0;
    let entityTotal = 0;

    for (const testCase of corpus) {
      const parsed = await service.parseIntent(testCase.message, testCase.context);
      const result = evaluateCase(testCase, parsed);

      const intentStat = perIntent.get(testCase.expected.intent) || {
        total: 0,
        correct: 0,
      };
      intentStat.total += 1;
      if (result.intentOk) intentStat.correct += 1;
      perIntent.set(testCase.expected.intent, intentStat);

      if (result.intentOk) intentPass += 1;

      if (result.hasTemporalExpectation) {
        temporalTotal += 1;
        if (result.temporalOk) temporalPass += 1;
      }

      if (result.hasEntityExpectation) {
        entityTotal += 1;
        if (result.entityOk) entityPass += 1;
      }

      if (!result.intentOk || !result.temporalOk || !result.entityOk) {
        failures.push({
          id: testCase.id,
          message: testCase.message,
          tags: testCase.tags,
          expectedIntent: testCase.expected.intent,
          actualIntent: parsed.intent,
          reasons: result.reasons,
        });
      }
    }

    const intentAccuracy = intentPass / corpus.length;
    const temporalAccuracy = temporalTotal > 0 ? temporalPass / temporalTotal : 1;
    const entityAccuracy = entityTotal > 0 ? entityPass / entityTotal : 1;

    const sortedIntentRows = [...perIntent.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    const reportsDir = path.join(process.cwd(), 'tmp_reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    const generatedAt = new Date();
    const timestamp = generatedAt.toISOString().replace(/[:.]/g, '-');

    const reportPayload = {
      generatedAt: generatedAt.toISOString(),
      corpusSize: corpus.length,
      metrics: {
        intentAccuracy,
        temporalAccuracy,
        entityAccuracy,
      },
      thresholds: {
        intentMin: 0.86,
        temporalMin: 0.82,
        entityMin: 0.8,
      },
      perIntent: sortedIntentRows.map(([intent, stat]) => ({
        intent,
        correct: stat.correct,
        total: stat.total,
        accuracy: stat.total > 0 ? stat.correct / stat.total : 0,
      })),
      failures: failures.slice(0, 50),
    };

    const latestJson = path.join(reportsDir, 'nlp-fallback-scoring-latest.json');
    const latestMd = path.join(reportsDir, 'nlp-fallback-scoring-latest.md');
    const archivedJson = path.join(reportsDir, `nlp-fallback-scoring-${timestamp}.json`);
    const archivedMd = path.join(reportsDir, `nlp-fallback-scoring-${timestamp}.md`);

    const perIntentMd = sortedIntentRows
      .map(([intent, stat]) => {
        const accuracy = stat.total > 0 ? ((stat.correct / stat.total) * 100).toFixed(1) : '0.0';
        return `| ${intent} | ${stat.correct} | ${stat.total} | ${accuracy}% |`;
      })
      .join('\n');

    const failuresMd = failures
      .slice(0, 25)
      .map((f) => `- ${f.id}: ${f.message}\n  - ${f.reasons.join('; ')}`)
      .join('\n');

    const markdown = [
      '# NLP Fallback Scoring Report',
      '',
      `- Generated at: ${reportPayload.generatedAt}`,
      `- Corpus size: ${corpus.length}`,
      `- Intent accuracy: ${(intentAccuracy * 100).toFixed(2)}%`,
      `- Temporal accuracy: ${(temporalAccuracy * 100).toFixed(2)}%`,
      `- Entity accuracy: ${(entityAccuracy * 100).toFixed(2)}%`,
      '',
      '## Per Intent',
      '',
      '| Intent | Correct | Total | Accuracy |',
      '|---|---:|---:|---:|',
      perIntentMd,
      '',
      '## Top Failures',
      '',
      failuresMd || '- No failures',
      '',
      '## Quality Gate',
      '',
      `- intent >= 86%: ${intentAccuracy >= 0.86 ? 'PASS' : 'FAIL'}`,
      `- temporal >= 82%: ${temporalAccuracy >= 0.82 ? 'PASS' : 'FAIL'}`,
      `- entity >= 80%: ${entityAccuracy >= 0.8 ? 'PASS' : 'FAIL'}`,
      '',
    ].join('\n');

    fs.writeFileSync(latestJson, JSON.stringify(reportPayload, null, 2), 'utf8');
    fs.writeFileSync(archivedJson, JSON.stringify(reportPayload, null, 2), 'utf8');
    fs.writeFileSync(latestMd, markdown, 'utf8');
    fs.writeFileSync(archivedMd, markdown, 'utf8');

    expect(intentAccuracy).toBeGreaterThanOrEqual(0.86);
    expect(temporalAccuracy).toBeGreaterThanOrEqual(0.82);
    expect(entityAccuracy).toBeGreaterThanOrEqual(0.8);
  });
});
