/**
 * Test Status-Aware Match Explanations
 *
 * Validates the implementation of conditional system prompts and status-aware caching.
 * Tests all three program statuses: ACTIVE, EXPIRED, ARCHIVED
 */

import { generateMatchExplanation } from '@/lib/ai/services/match-explanation';
import type { MatchExplanationInput } from '@/lib/ai/prompts/match-explanation';

// Test cases for all three program statuses
const testCases: MatchExplanationInput[] = [
  // Test 1: ACTIVE program with urgent deadline
  {
    programTitle: 'AI 기반 SaaS 상용화 지원',
    programAgency: '정보통신기획평가원',
    programBudget: '최대 3억원',
    programTRL: 'TRL 7-8',
    programIndustry: 'AI/ML, SaaS',
    programDeadline: new Date('2025-12-15'), // 20 days from now
    programStatus: 'ACTIVE',
    programRequirements: ['ISMS-P 인증', 'TRL 7 이상', 'AI 기술 보유'],
    companyName: '테스트테크',
    companyIndustry: 'AI/ML, SaaS',
    companyTRL: 8,
    companyRevenue: 5000000000,
    companyEmployees: 30,
    certifications: ['ISMS-P'],
    rdExperience: 5,
    matchScore: 85,
    scoreBreakdown: {
      keyword: 15,
      industry: 25,
      trl: 18,
      type: 15,
      rd: 12,
      deadline: 0,
    },
  },

  // Test 2: EXPIRED program (anti-churn strategy)
  {
    programTitle: '(5G6G) 일반형 공동연구',
    programAgency: '정보통신기획평가원',
    programBudget: '최대 5억원',
    programTRL: 'TRL 4-6',
    programIndustry: '5G/6G, 통신',
    programDeadline: new Date('2024-11-30'), // Already passed
    programStatus: 'EXPIRED',
    programRequirements: ['5G/6G 관련 기술', 'TRL 4 이상', '공동연구 가능'],
    companyName: '이노웨이브',
    companyIndustry: '5G/6G, 통신',
    companyTRL: 5,
    companyRevenue: 3000000000,
    companyEmployees: 25,
    certifications: [],
    rdExperience: 3,
    matchScore: 78,
    scoreBreakdown: {
      keyword: 18,
      industry: 28,
      trl: 16,
      type: 0,
      rd: 16,
      deadline: 0,
    },
  },

  // Test 3: ARCHIVED program (permanently discontinued)
  {
    programTitle: '디지털 뉴딜 기술개발 (중단)',
    programAgency: '한국산업기술평가관리원',
    programBudget: '최대 2억원',
    programTRL: 'TRL 5-7',
    programIndustry: 'ICT, 디지털',
    programDeadline: null, // No deadline (archived)
    programStatus: 'ARCHIVED',
    programRequirements: ['디지털 전환 기술', 'TRL 5 이상'],
    companyName: '디지털솔루션',
    companyIndustry: 'ICT, 디지털',
    companyTRL: 6,
    companyRevenue: 2000000000,
    companyEmployees: 20,
    certifications: [],
    rdExperience: 4,
    matchScore: 72,
    scoreBreakdown: {
      keyword: 15,
      industry: 26,
      trl: 16,
      type: 0,
      rd: 15,
      deadline: 0,
    },
  },
];

async function runTests() {
  console.log('=== Starting Status-Aware Explanation Tests ===\n');

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Test ${i + 1}: ${testCase.programStatus} Program - ${testCase.programTitle}`);
    console.log(`${'='.repeat(80)}\n`);

    console.log('Input Data:');
    console.log(`  - Program: ${testCase.programTitle}`);
    console.log(`  - Status: ${testCase.programStatus}`);
    console.log(`  - Deadline: ${testCase.programDeadline?.toISOString().split('T')[0] || 'None'}`);
    console.log(`  - Company: ${testCase.companyName}`);
    console.log(`  - Match Score: ${testCase.matchScore}/100\n`);

    try {
      const startTime = Date.now();

      const result = await generateMatchExplanation(
        testCase,
        'test-user-id', // Mock user ID for testing
        `test-org-${i}` // Mock organization ID for testing
      );

      const duration = Date.now() - startTime;

      console.log('✅ Generation Successful\n');
      console.log(`Cache Status: ${result.cached ? '🔥 CACHE HIT' : '🆕 CACHE MISS (New Generation)'}`);
      console.log(`Response Time: ${duration}ms`);
      console.log(`AI Cost: ${typeof result.cost === 'number' ? `$${result.cost.toFixed(4)}` : 'N/A (cached or logging failed)'}\n`);

      console.log('--- Generated Explanation ---\n');
      console.log(`Summary:\n${result.explanation.summary}\n`);
      console.log(`Reasons:`);
      result.explanation.reasons.forEach((reason, idx) => {
        console.log(`  ${idx + 1}. ${reason}`);
      });
      console.log(`\nRecommendation:\n${result.explanation.recommendation}\n`);

      if (result.explanation.cautions) {
        console.log(`Cautions:\n${result.explanation.cautions}\n`);
      }

      // Validate status-specific content
      console.log('--- Content Validation ---\n');
      const fullText = `${result.explanation.summary} ${result.explanation.reasons.join(' ')} ${result.explanation.cautions || ''} ${result.explanation.recommendation}`.toLowerCase();

      if (testCase.programStatus === 'ACTIVE') {
        const hasActiveLanguage = fullText.includes('신청') || fullText.includes('지원');
        const hasUrgency = testCase.programDeadline && fullText.includes('마감');
        console.log(`  ✓ Active language check: ${hasActiveLanguage ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`  ✓ Deadline urgency check: ${hasUrgency ? '✅ PASS' : '⚠️  OPTIONAL'}`);
      }

      if (testCase.programStatus === 'EXPIRED') {
        const hasNoActiveLanguage = !fullText.includes('신청하세요') && !fullText.includes('지원하세요');
        const hasNo2026Prep = fullText.includes('2026');
        const hasNoErrorMention = !fullText.includes('시스템 오류');
        console.log(`  ✓ No active CTA check: ${hasNoActiveLanguage ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`  ✓ 2026 preparation focus: ${hasNo2026Prep ? '✅ PASS' : '⚠️  OPTIONAL'}`);
        console.log(`  ✓ No error mention check: ${hasNoErrorMention ? '✅ PASS' : '❌ FAIL'}`);
      }

      if (testCase.programStatus === 'ARCHIVED') {
        const hasAlternativeGuidance = fullText.includes('유사') || fullText.includes('대체');
        const hasNoErrorMention = !fullText.includes('시스템 오류');
        console.log(`  ✓ Alternative guidance: ${hasAlternativeGuidance ? '✅ PASS' : '⚠️  OPTIONAL'}`);
        console.log(`  ✓ No error mention check: ${hasNoErrorMention ? '✅ PASS' : '❌ FAIL'}`);
      }

    } catch (error) {
      console.error('❌ Generation Failed\n');
      console.error('Error:', error instanceof Error ? error.message : String(error));

      if (error instanceof Error && error.stack) {
        console.error('\nStack Trace:');
        console.error(error.stack);
      }
    }

    // Wait 2 seconds between tests to avoid rate limiting
    if (i < testCases.length - 1) {
      console.log('\n⏳ Waiting 2 seconds before next test...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('=== All Tests Completed ===');
  console.log(`${'='.repeat(80)}\n`);

  // Test cache key verification
  console.log('\n--- Cache Key Verification ---\n');
  console.log('Expected cache key format: match:explanation:{orgId}:{programId}:{status}');
  console.log('\nRunning duplicate test to verify cache hit with same status...\n');

  try {
    const duplicateTest = testCases[0]; // Re-run ACTIVE test
    const result = await generateMatchExplanation(
      duplicateTest,
      'test-user-id',
      'test-org-0'
    );

    console.log(`Cache Status: ${result.cached ? '✅ CACHE HIT (status-aware key working)' : '❌ CACHE MISS (unexpected)'}`);
  } catch (error) {
    console.error('❌ Cache verification failed:', error);
  }

  console.log('\n✅ Test suite completed. Check logs above for state inconsistency warnings.\n');
}

// Run tests
runTests().catch(console.error);
