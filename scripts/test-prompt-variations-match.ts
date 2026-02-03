/**
 * Match Explanation Prompt Variation Testing
 * Week 3-4: AI Integration (Day 20-21)
 *
 * Tests 5 different prompt variations to find optimal approach:
 * 1. BASELINE (current): Structured XML, 200-char limit, balanced formality
 * 2. CONCISE: Ultra-short, bullet points, action-focused
 * 3. DETAILED: Longer explanations, more context, examples
 * 4. DATA_DRIVEN: Heavy emphasis on numbers, benchmarks, statistics
 * 5. FRIENDLY: More conversational, less formal, warmer tone
 *
 * Metrics:
 * - Response time (ms)
 * - Token usage (input/output)
 * - Cost (KRW)
 * - Korean quality (manual review, 1-5)
 * - Helpfulness (simulated scoring based on completeness)
 * - Consistency (variation between responses)
 *
 * Usage:
 * npx tsx scripts/test-prompt-variations-match.ts
 */

import { sendAIRequest } from '../lib/ai/client';
import { MatchExplanationInput } from '../lib/ai/prompts/match-explanation';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

// ========================================
// PROMPT VARIATIONS
// ========================================

type PromptVariation = {
  name: string;
  description: string;
  buildPrompt: (input: MatchExplanationInput) => string;
};

const promptVariations: PromptVariation[] = [
  // VARIATION 1: BASELINE (Current)
  {
    name: 'BASELINE',
    description: '현재 프롬프트 (구조화된 XML, 200자 제한, 균형잡힌 형식)',
    buildPrompt: (input: MatchExplanationInput) => {
      const systemPrompt = `당신은 Connect 플랫폼의 AI 매칭 전문가입니다.

역할:
- 한국 정부 R&D 과제와 기업의 매칭 결과를 설명
- 왜 적합한지 구체적인 근거 제시
- 신청 시 주의사항 안내
- 전문적이면서 친근한 존댓말 사용

제약사항:
- 선정을 보장하는 표현 금지 ("반드시 선정됩니다" ❌)
- 일반적인 안내만 제공 ("일반적으로 적합합니다" ✅)
- 최종 확인은 공고문 참조 안내 필수`;

      const userPrompt = `<company_info>
회사명: ${input.companyName}
산업 분야: ${input.companyIndustry}
기술 수준: TRL ${input.companyTRL}
연매출: ${input.companyRevenue.toLocaleString('ko-KR')}원
</company_info>

<program_info>
과제명: ${input.programTitle}
주관 기관: ${input.programAgency}
요구 TRL: ${input.programTRL}
대상 산업: ${input.programIndustry}
</program_info>

<match_score>
총점: ${input.matchScore}/100점
- 산업 분야: ${input.scoreBreakdown.industry}/30점
- TRL 적합성: ${input.scoreBreakdown.trl}/20점
- 조직 유형: ${input.scoreBreakdown.type}/15점
</match_score>

<instructions>
위 정보를 바탕으로 매칭 결과를 설명해주세요.

응답 구조:
1. <summary>한 문장 요약</summary>
2. <reasons>
   <reason>이유 1</reason>
   <reason>이유 2</reason>
   <reason>이유 3</reason>
   </reasons>
3. <recommendation>다음 단계 제안</recommendation>

- 각 이유는 30-50자 내외
- 존댓말 필수
- 총 200자 이내로 간결하게
</instructions>

매칭 설명을 작성해주세요.`;

      return `${systemPrompt}\n\n${userPrompt}`;
    },
  },

  // VARIATION 2: CONCISE
  {
    name: 'CONCISE',
    description: '초간결형 (핵심만, 불릿 포인트, 액션 중심)',
    buildPrompt: (input: MatchExplanationInput) => {
      return `당신은 간결한 AI 매칭 어시스턴트입니다.

<task>
기업: ${input.companyName} (${input.companyIndustry}, TRL ${input.companyTRL})
과제: ${input.programTitle} (${input.programAgency})
매칭 점수: ${input.matchScore}/100

3가지만 전달:
1. 적합 여부 (한 문장)
2. 핵심 이유 2개 (각 15자 이내)
3. 다음 액션 (한 문장)

존댓말, 100자 이내, 불릿 포인트 형식
</task>`;
    },
  },

  // VARIATION 3: DETAILED
  {
    name: 'DETAILED',
    description: '상세형 (긴 설명, 맥락 제공, 예시 포함)',
    buildPrompt: (input: MatchExplanationInput) => {
      return `당신은 Connect 플랫폼의 상세 매칭 분석 전문가입니다.

<company_profile>
회사: ${input.companyName}
산업: ${input.companyIndustry}
기술성숙도: TRL ${input.companyTRL}
연매출: ${input.companyRevenue.toLocaleString('ko-KR')}원
인증: ${input.certifications.join(', ') || '없음'}
R&D 경력: ${input.rdExperience}년
</company_profile>

<program_details>
과제명: ${input.programTitle}
주관 기관: ${input.programAgency}
지원 예산: ${input.programBudget}
요구 TRL: ${input.programTRL}
대상 산업: ${input.programIndustry}
마감일: ${input.programDeadline}
</program_details>

<scoring_analysis>
총점: ${input.matchScore}/100
- 산업 매칭: ${input.scoreBreakdown.industry}/30점
- TRL 적합성: ${input.scoreBreakdown.trl}/20점
- 조직 유형: ${input.scoreBreakdown.type}/15점
- R&D 경험: ${input.scoreBreakdown.rd}/10점
- 마감일 근접도: ${input.scoreBreakdown.deadline}/15점
</scoring_analysis>

<instructions>
위 데이터를 종합 분석하여 상세한 매칭 설명을 제공하세요.

응답 구조:
1. 종합 평가 (2-3 문장): 전반적인 적합도와 주요 강점
2. 세부 분석 (4-5개 항목): 각 점수 항목별 구체적 설명
3. 주의사항 (있을 경우): 부족한 부분이나 리스크 요인
4. 실행 계획: 신청 준비를 위한 구체적 단계 (3-4개)
5. 참고 정보: 유사 사례나 성공률 (있을 경우)

- 전문적이고 상세한 존댓말
- 300-400자 분량
- 구체적 숫자와 근거 포함
</instructions>

상세한 매칭 분석을 작성해주세요.`;
    },
  },

  // VARIATION 4: DATA_DRIVEN
  {
    name: 'DATA_DRIVEN',
    description: '데이터 중심형 (숫자, 벤치마크, 통계 강조)',
    buildPrompt: (input: MatchExplanationInput) => {
      return `당신은 데이터 기반 AI 분석 전문가입니다.

<quantitative_analysis>
기업 프로필:
- 산업: ${input.companyIndustry}
- TRL: ${input.companyTRL}/9
- 매출: ${input.companyRevenue.toLocaleString('ko-KR')}원
- R&D 경험: ${input.rdExperience}년

과제 요구사항:
- 요구 TRL: ${input.programTRL}
- 대상 산업: ${input.programIndustry}

매칭 스코어:
- 총점: ${input.matchScore}/100 (상위 ${100 - input.matchScore}% 수준)
- 산업 매칭: ${input.scoreBreakdown.industry}/30 (${((input.scoreBreakdown.industry / 30) * 100).toFixed(0)}%)
- TRL 적합성: ${input.scoreBreakdown.trl}/20 (${((input.scoreBreakdown.trl / 20) * 100).toFixed(0)}%)
- 조직 유형: ${input.scoreBreakdown.type}/15 (${((input.scoreBreakdown.type / 15) * 100).toFixed(0)}%)
- R&D 경험: ${input.scoreBreakdown.rd}/10 (${((input.scoreBreakdown.rd / 10) * 100).toFixed(0)}%)
- 마감일: ${input.scoreBreakdown.deadline}/15 (${((input.scoreBreakdown.deadline / 15) * 100).toFixed(0)}%)
</quantitative_analysis>

${input.similarSuccessRate ? `
<benchmark_data>
유사 기업 평균 선정률: ${input.similarSuccessRate}%
</benchmark_data>` : ''}

<output_format>
다음 형식으로 응답:
1. 매칭 확률: X% (근거 포함)
2. 핵심 지표 3개: 각 지표의 정량적 평가
3. 벤치마크 비교: 유사 기업 대비 위치
4. 개선 가능성: 점수 향상 가능한 영역과 예상 증가폭

- 모든 설명에 숫자 포함 필수
- 백분율, 점수, 순위 등 정량 지표 활용
- 존댓말, 200-250자
</output_format>

데이터 기반 매칭 분석을 작성해주세요.`;
    },
  },

  // VARIATION 5: FRIENDLY
  {
    name: 'FRIENDLY',
    description: '친근형 (대화체, 덜 공식적, 따뜻한 톤)',
    buildPrompt: (input: MatchExplanationInput) => {
      return `당신은 친근하고 도움이 되는 AI 어시스턴트입니다.

<conversation_context>
${input.companyName}님, 안녕하세요! 😊

${input.programTitle} 과제와의 매칭 결과를 알려드릴게요.

기업 정보:
- 산업: ${input.companyIndustry}
- 기술 단계: TRL ${input.companyTRL}
- 연매출: ${input.companyRevenue.toLocaleString('ko-KR')}원

과제 정보:
- 주관: ${input.programAgency}
- 요구 TRL: ${input.programTRL}
- 마감: ${input.programDeadline}

매칭 점수: ${input.matchScore}/100점
</conversation_context>

<tone_guidelines>
- 친근하면서도 전문적인 존댓말 (격식 낮추기)
- 긍정적이고 격려하는 톤
- 이모지 1-2개 사용 가능
- "귀사" 대신 "OO님의 회사", "함께" 같은 표현
- 불안감 해소, 자신감 부여

응답 구조:
1. 간단한 인사와 결과 요약
2. 좋은 점 2-3개 (긍정 먼저!)
3. 주의할 점 (있다면, 부드럽게)
4. 응원 메시지와 다음 단계

- 200-250자
- 따뜻하고 격려하는 느낌
</tone_guidelines>

매칭 결과를 친근하게 설명해주세요.`;
    },
  },
];

// ========================================
// TEST DATA
// ========================================

const testCases: MatchExplanationInput[] = [
  // Test case 1: High match (AI SaaS)
  {
    programTitle: 'AI 기반 SaaS 상용화 지원',
    programAgency: 'IITP',
    programBudget: '최대 3억원',
    programTRL: 'TRL 7-8',
    programIndustry: 'AI/ML, SaaS',
    programDeadline: new Date('2025-11-15'),
    programStatus: 'ACTIVE' as const,
    programRequirements: ['ISMS-P 인증', 'TRL 7 이상', 'AI 기술 보유'],
    companyName: '(주)클라우드AI',
    companyIndustry: 'AI/ML SaaS',
    companyTRL: 7,
    companyRevenue: 1500000000,
    companyEmployees: 25,
    certifications: ['ISMS-P', 'ISO 27001'],
    rdExperience: 3,
    matchScore: 85,
    scoreBreakdown: {
      keyword: 20,
      industry: 28,
      trl: 18,
      type: 12,
      rd: 7,
      deadline: 0,
    },
    missingRequirements: [],
    similarSuccessRate: 42,
  },

  // Test case 2: Medium match (IoT Hardware)
  {
    programTitle: 'IoT 기반 스마트센서 기술개발',
    programAgency: 'KEIT',
    programBudget: '최대 5억원',
    programTRL: 'TRL 5-7',
    programIndustry: 'IoT, 센서',
    programDeadline: new Date('2025-12-01'),
    programStatus: 'ACTIVE' as const,
    programRequirements: ['KC 인증', 'TRL 6 이상', '하드웨어 개발 경험'],
    companyName: '(주)스마트센서',
    companyIndustry: 'IoT Hardware',
    companyTRL: 6,
    companyRevenue: 5000000000,
    companyEmployees: 50,
    certifications: ['KC', 'ISO 9001'],
    rdExperience: 5,
    matchScore: 72,
    scoreBreakdown: {
      keyword: 15,
      industry: 25,
      trl: 16,
      type: 10,
      rd: 6,
      deadline: 0,
    },
    missingRequirements: ['TRL 7 미달'],
    similarSuccessRate: 35,
  },

  // Test case 3: Low match (Biotech)
  {
    programTitle: 'AI 기반 의료진단 소프트웨어 개발',
    programAgency: 'IITP',
    programBudget: '최대 2억원',
    programTRL: 'TRL 8-9',
    programIndustry: 'AI, 의료SW',
    programDeadline: new Date('2025-10-30'),
    programStatus: 'ACTIVE' as const,
    programRequirements: ['의료기기 허가', 'TRL 8 이상', 'AI 전문인력'],
    companyName: '(주)바이오메드',
    companyIndustry: 'Biotechnology',
    companyTRL: 4,
    companyRevenue: 800000000,
    companyEmployees: 15,
    certifications: [],
    rdExperience: 2,
    matchScore: 45,
    scoreBreakdown: {
      keyword: 0,
      industry: 10,
      trl: 5,
      type: 8,
      rd: 2,
      deadline: 0,
    },
    missingRequirements: ['TRL 8 미달', '의료기기 허가 없음', 'AI 전문성 부족'],
    similarSuccessRate: 18,
  },
];

// ========================================
// TEST EXECUTION
// ========================================

interface TestResult {
  variation: string;
  testCase: number;
  response: string;
  responseTime: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  characterCount: number;
  error?: string;
}

async function testVariation(
  variation: PromptVariation,
  testCase: MatchExplanationInput,
  testCaseIndex: number
): Promise<TestResult> {
  console.log(`\n${colors.cyan}Testing: ${variation.name} - Case ${testCaseIndex + 1}${colors.reset}`);

  const startTime = Date.now();

  try {
    const prompt = variation.buildPrompt(testCase);
    const result = await sendAIRequest({
      system: '',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 800,
      temperature: 0.7, // Fixed temperature for variation testing
    });

    const responseTime = Date.now() - startTime;

    return {
      variation: variation.name,
      testCase: testCaseIndex + 1,
      response: result.content,
      responseTime,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cost: result.cost,
      characterCount: result.content.length,
    };
  } catch (error: any) {
    return {
      variation: variation.name,
      testCase: testCaseIndex + 1,
      response: '',
      responseTime: Date.now() - startTime,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      characterCount: 0,
      error: error.message,
    };
  }
}

// ========================================
// ANALYSIS & REPORTING
// ========================================

function analyzeResults(results: TestResult[]) {
  console.log(`\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.cyan}결과 분석${colors.reset}`);
  console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  // Group by variation
  const byVariation = new Map<string, TestResult[]>();
  for (const result of results) {
    if (!byVariation.has(result.variation)) {
      byVariation.set(result.variation, []);
    }
    byVariation.get(result.variation)!.push(result);
  }

  // Calculate averages per variation
  for (const [variationName, variationResults] of byVariation.entries()) {
    const successfulResults = variationResults.filter(r => !r.error);
    if (successfulResults.length === 0) continue;

    const avgResponseTime = successfulResults.reduce((sum, r) => sum + r.responseTime, 0) / successfulResults.length;
    const avgInputTokens = successfulResults.reduce((sum, r) => sum + r.inputTokens, 0) / successfulResults.length;
    const avgOutputTokens = successfulResults.reduce((sum, r) => sum + r.outputTokens, 0) / successfulResults.length;
    const totalCost = successfulResults.reduce((sum, r) => sum + r.cost, 0);
    const avgCharCount = successfulResults.reduce((sum, r) => sum + r.characterCount, 0) / successfulResults.length;

    console.log(`${colors.yellow}${variationName}${colors.reset}`);
    console.log(`  응답 시간: ${avgResponseTime.toFixed(0)}ms`);
    console.log(`  입력 토큰: ${avgInputTokens.toFixed(0)}`);
    console.log(`  출력 토큰: ${avgOutputTokens.toFixed(0)}`);
    console.log(`  총 비용: ₩${totalCost.toFixed(2)}`);
    console.log(`  평균 글자수: ${avgCharCount.toFixed(0)}자`);
    console.log(`  성공률: ${successfulResults.length}/${variationResults.length}\n`);
  }

  // Print sample responses
  console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.cyan}샘플 응답 (Test Case 1 - High Match)${colors.reset}`);
  console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  const case1Results = results.filter(r => r.testCase === 1 && !r.error);
  for (const result of case1Results) {
    console.log(`${colors.magenta}[${result.variation}]${colors.reset}`);
    console.log(result.response);
    console.log(`${colors.yellow}(${result.characterCount}자, ${result.responseTime}ms, ₩${result.cost.toFixed(2)})${colors.reset}\n`);
  }
}

// ========================================
// MAIN
// ========================================

async function main() {
  console.log('========================================');
  console.log('Match Explanation Prompt Variation Testing');
  console.log('Week 3-4: AI Integration (Day 20-21)');
  console.log('========================================');
  console.log(`\n총 ${promptVariations.length}개 변형 × ${testCases.length}개 케이스 = ${promptVariations.length * testCases.length}개 테스트\n`);

  const allResults: TestResult[] = [];

  for (const variation of promptVariations) {
    console.log(`\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`${colors.cyan}Variation: ${variation.name}${colors.reset}`);
    console.log(`${colors.yellow}${variation.description}${colors.reset}`);
    console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);

    for (let i = 0; i < testCases.length; i++) {
      const result = await testVariation(variation, testCases[i], i);
      allResults.push(result);

      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  // Analyze and report
  analyzeResults(allResults);

  console.log(`\n${colors.yellow}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.cyan}다음 단계:${colors.reset}`);
  console.log('  1. 각 변형의 품질을 수동 검토 (존댓말, 정확성, 유용성)');
  console.log('  2. 가장 효과적인 프롬프트 스타일 선택');
  console.log('  3. Temperature 최적화 테스트 진행');
  console.log('  4. 선택된 변형으로 프롬프트 업데이트');
  console.log(`${colors.yellow}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  console.log('========================================\n');
}

main().catch((error) => {
  console.error(`\n${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
