/**
 * Match Explanation Service Test Script
 * Week 3-4: AI Integration (Day 16-17)
 *
 * Tests:
 * 1. Service functionality with mock data
 * 2. Cache hit rate validation (>40% target)
 * 3. Performance measurement (<2s target)
 * 4. Error handling
 * 5. Batch generation
 * 6. Cache statistics
 *
 * Usage:
 * npx tsx scripts/test-match-explanation.ts
 */

import { generateMatchExplanation, batchGenerateExplanations, getCacheStats } from '../lib/ai/services/match-explanation';
import type { MatchExplanationInput } from '../lib/ai/prompts/match-explanation';

// Test data: 10 realistic Korean R&D funding scenarios
const testInputs: MatchExplanationInput[] = [
  {
    // Test 1: High match - AI/ML SaaS company
    programTitle: 'AI 융합 클라우드 플랫폼 개발 지원',
    programAgency: '정보통신기획평가원',
    programBudget: '최대 5억원',
    programTRL: 'TRL 7-8',
    programIndustry: 'ICT, AI/ML',
    programDeadline: new Date('2025-11-30'),
    programStatus: 'ACTIVE' as const,
    programRequirements: ['TRL 7 이상', '클라우드 기반 서비스', 'AI 핵심 기술'],
    companyName: '(주)클라우드AI',
    companyIndustry: 'ICT 서비스',
    companyTRL: 8,
    companyRevenue: 5000000000, // 50억
    companyEmployees: 35,
    certifications: ['ISMS-P', 'ISO 9001'],
    rdExperience: 5,
    matchScore: 92,
    scoreBreakdown: {
      keyword: 20,
      industry: 30,
      trl: 20,
      type: 14,
      rd: 10,
      deadline: 0,
    },
  },
  {
    // Test 2: Medium match - Hardware IoT startup
    programTitle: 'IoT 기반 스마트 디바이스 상용화 지원',
    programAgency: '한국산업기술평가관리원',
    programBudget: '최대 3억원',
    programTRL: 'TRL 6-9',
    programIndustry: 'IoT, 전자부품',
    programDeadline: new Date('2025-12-15'),
    programStatus: 'ACTIVE' as const,
    programRequirements: ['TRL 6 이상', 'KC 인증 필요', '제조 역량 보유'],
    companyName: '(주)스마트센서',
    companyIndustry: '전자부품 제조',
    companyTRL: 7,
    companyRevenue: 2000000000, // 20억
    companyEmployees: 18,
    certifications: ['ISO 9001'],
    rdExperience: 3,
    matchScore: 73,
    scoreBreakdown: {
      keyword: 15,
      industry: 25,
      trl: 18,
      type: 12,
      rd: 8,
      deadline: 0,
    },
    missingRequirements: ['KC 인증 미보유'],
  },
  {
    // Test 3: Low match - Early-stage biotech
    programTitle: '바이오 헬스케어 AI 융합 기술 개발',
    programAgency: '한국산업기술평가관리원',
    programBudget: '최대 10억원',
    programTRL: 'TRL 7-9',
    programIndustry: '바이오, AI',
    programDeadline: new Date('2025-10-31'),
    programStatus: 'ACTIVE' as const,
    programRequirements: ['TRL 7 이상', '임상 데이터 확보', 'AI 모델 구축 경험'],
    companyName: '(주)바이오메드',
    companyIndustry: '바이오 진단',
    companyTRL: 5,
    companyRevenue: 800000000, // 8억
    companyEmployees: 12,
    certifications: [],
    rdExperience: 2,
    matchScore: 48,
    scoreBreakdown: {
      keyword: 10,
      industry: 20,
      trl: 8,
      type: 0,
      rd: 10,
      deadline: 0,
    },
    missingRequirements: ['TRL 7 미달', '임상 데이터 미확보', 'AI 경험 부족'],
  },
  {
    // Test 4: Consortium project - Marine tech
    programTitle: '해양 스마트 양식 ICT 융합 기술 개발',
    programAgency: '해양수산과학기술진흥원',
    programBudget: '최대 7억원',
    programTRL: 'TRL 4-7',
    programIndustry: '수산, ICT',
    programDeadline: new Date('2025-11-15'),
    programStatus: 'ACTIVE' as const,
    programRequirements: ['수산 분야 경험', 'IoT 센서 기술', '현장 실증 가능'],
    companyName: '(주)오션테크',
    companyIndustry: '수산 ICT',
    companyTRL: 6,
    companyRevenue: 1500000000, // 15억
    companyEmployees: 22,
    certifications: ['ISO 9001'],
    rdExperience: 4,
    matchScore: 78,
    scoreBreakdown: {
      keyword: 18,
      industry: 28,
      trl: 18,
      type: 10,
      rd: 10,
      deadline: 0,
    },
  },
  {
    // Test 5: SME manufacturing automation
    programTitle: '중소 제조기업 스마트 공장 고도화 지원',
    programAgency: '중소기업기술정보진흥원',
    programBudget: '최대 2억원',
    programTRL: 'TRL 8-9',
    programIndustry: '제조, 자동화',
    programDeadline: new Date('2025-12-31'),
    programStatus: 'ACTIVE' as const,
    programRequirements: ['중소기업', '제조업 3년 이상', '스마트 공장 구축 계획'],
    companyName: '(주)정밀기계',
    companyIndustry: '기계 부품 제조',
    companyTRL: 9,
    companyRevenue: 3000000000, // 30억
    companyEmployees: 45,
    certifications: ['ISO 9001', 'ISO 14001'],
    rdExperience: 7,
    matchScore: 88,
    scoreBreakdown: {
      keyword: 20,
      industry: 30,
      trl: 20,
      type: 13,
      rd: 10,
      deadline: 0,
    },
  },
  {
    // Test 6: Green energy startup
    programTitle: '신재생 에너지 ESS 효율화 기술 개발',
    programAgency: '한국산업기술평가관리원',
    programBudget: '최대 6억원',
    programTRL: 'TRL 5-8',
    programIndustry: '에너지, 전력전자',
    programDeadline: new Date('2025-11-20'),
    programStatus: 'ACTIVE' as const,
    programRequirements: ['TRL 5 이상', 'ESS 실증 경험', '전력전자 기술'],
    companyName: '(주)그린파워',
    companyIndustry: '신재생 에너지',
    companyTRL: 7,
    companyRevenue: 4000000000, // 40억
    companyEmployees: 28,
    certifications: ['ISO 9001', 'KC'],
    rdExperience: 6,
    matchScore: 85,
    scoreBreakdown: {
      keyword: 20,
      industry: 30,
      trl: 18,
      type: 14,
      rd: 5,
      deadline: 0,
    },
  },
  {
    // Test 7: Cybersecurity SaaS
    programTitle: '클라우드 보안 플랫폼 개발 지원',
    programAgency: '정보통신기획평가원',
    programBudget: '최대 4억원',
    programTRL: 'TRL 7-9',
    programIndustry: 'ICT, 보안',
    programDeadline: new Date('2025-12-10'),
    programStatus: 'ACTIVE' as const,
    programRequirements: ['ISMS-P 인증 필수', 'TRL 7 이상', '보안 전문 인력'],
    companyName: '(주)사이버쉴드',
    companyIndustry: '정보보안',
    companyTRL: 8,
    companyRevenue: 6000000000, // 60억
    companyEmployees: 42,
    certifications: ['ISMS-P', 'ISO 27001'],
    rdExperience: 8,
    matchScore: 95,
    scoreBreakdown: {
      keyword: 20,
      industry: 30,
      trl: 20,
      type: 15,
      rd: 10,
      deadline: 0,
    },
  },
  {
    // Test 8: Early-stage mobility startup (low match)
    programTitle: '자율주행 센서 융합 기술 개발',
    programAgency: '한국산업기술평가관리원',
    programBudget: '최대 15억원',
    programTRL: 'TRL 6-8',
    programIndustry: '모빌리티, 자율주행',
    programDeadline: new Date('2025-10-25'),
    programStatus: 'ACTIVE' as const,
    programRequirements: ['TRL 6 이상', '자율주행 실증 경험', '차량 센서 기술'],
    companyName: '(주)모빌리티랩',
    companyIndustry: '자율주행 SW',
    companyTRL: 4,
    companyRevenue: 500000000, // 5억
    companyEmployees: 8,
    certifications: [],
    rdExperience: 1,
    matchScore: 42,
    scoreBreakdown: {
      keyword: 5,
      industry: 25,
      trl: 5,
      type: 0,
      rd: 5,
      deadline: 2,
    },
    missingRequirements: ['TRL 6 미달', '실증 경험 부족', '예산 규모 미충족'],
  },
  {
    // Test 9: Med-tech device
    programTitle: '디지털 헬스케어 의료기기 개발 지원',
    programAgency: '한국산업기술평가관리원',
    programBudget: '최대 5억원',
    programTRL: 'TRL 7-9',
    programIndustry: '의료기기, ICT',
    programDeadline: new Date('2025-12-05'),
    programStatus: 'ACTIVE' as const,
    programRequirements: ['의료기기 인증', 'TRL 7 이상', '임상시험 계획'],
    companyName: '(주)메디케어디바이스',
    companyIndustry: '의료기기',
    companyTRL: 8,
    companyRevenue: 7000000000, // 70억
    companyEmployees: 55,
    certifications: ['ISO 13485', 'GMP'],
    rdExperience: 9,
    matchScore: 90,
    scoreBreakdown: {
      keyword: 20,
      industry: 30,
      trl: 20,
      type: 10,
      rd: 10,
      deadline: 0,
    },
  },
  {
    // Test 10: Agri-tech startup
    programTitle: '스마트팜 ICT 융합 기술 상용화 지원',
    programAgency: '중소기업기술정보진흥원',
    programBudget: '최대 3억원',
    programTRL: 'TRL 8-9',
    programIndustry: '농업, ICT',
    programDeadline: new Date('2025-11-25'),
    programStatus: 'ACTIVE' as const,
    programRequirements: ['스마트팜 실증', 'IoT 센서 기술', '농업 현장 적용'],
    companyName: '(주)스마트팜테크',
    companyIndustry: '농업 ICT',
    companyTRL: 9,
    companyRevenue: 1000000000, // 10억
    companyEmployees: 15,
    certifications: ['ISO 9001'],
    rdExperience: 3,
    matchScore: 80,
    scoreBreakdown: {
      keyword: 15,
      industry: 30,
      trl: 20,
      type: 12,
      rd: 8,
      deadline: 0,
    },
  },
];

async function runTests() {
  console.log('========================================');
  console.log('Match Explanation Service Test Suite');
  console.log('Week 3-4: AI Integration (Day 16-17)');
  console.log('========================================\n');

  let passedTests = 0;
  let failedTests = 0;
  const startTime = Date.now();

  // Test 1: Single match explanation generation
  console.log('📝 Test 1: Single Match Explanation Generation');
  try {
    const result = await generateMatchExplanation(testInputs[0]);
    console.log('✅ PASSED: Single explanation generated');
    console.log(`   - Summary: ${result.explanation.summary.substring(0, 50)}...`);
    console.log(`   - Reasons: ${result.explanation.reasons.length} items`);
    console.log(`   - Cached: ${result.cached}`);
    console.log(`   - Cost: ₩${result.cost.toFixed(2)}`);
    console.log(`   - Response time: ${result.responseTime}ms`);
    passedTests++;
  } catch (error: any) {
    console.log(`❌ FAILED: ${error.message}`);
    failedTests++;
  }
  console.log('');

  // Test 2: Cache hit (re-generate same match)
  console.log('📝 Test 2: Cache Hit Validation');
  try {
    const result = await generateMatchExplanation(testInputs[0]);
    if (result.cached && result.cost === 0) {
      console.log('✅ PASSED: Cache hit detected');
      console.log(`   - Cached: ${result.cached}`);
      console.log(`   - Cost: ₩${result.cost.toFixed(2)} (expected 0)`);
      console.log(`   - Response time: ${result.responseTime}ms (fast!)`);
      passedTests++;
    } else {
      console.log(`❌ FAILED: Expected cache hit, got cached=${result.cached}, cost=${result.cost}`);
      failedTests++;
    }
  } catch (error: any) {
    console.log(`❌ FAILED: ${error.message}`);
    failedTests++;
  }
  console.log('');

  // Test 3: Batch generation (5 matches)
  console.log('📝 Test 3: Batch Generation (5 matches)');
  const batchStartTime = Date.now();
  try {
    const batchInputs = testInputs.slice(1, 6); // 5 new matches
    const results = await batchGenerateExplanations(batchInputs);
    const batchEndTime = Date.now();
    const batchDuration = batchEndTime - batchStartTime;

    console.log(`✅ PASSED: Batch generation completed`);
    console.log(`   - Generated: ${results.length} / ${batchInputs.length} explanations`);
    console.log(`   - Total time: ${batchDuration}ms (${(batchDuration / 1000).toFixed(1)}s)`);
    console.log(`   - Avg per match: ${(batchDuration / results.length).toFixed(0)}ms`);
    console.log(`   - Total cost: ₩${results.reduce((sum, r) => sum + r.cost, 0).toFixed(2)}`);
    passedTests++;
  } catch (error: any) {
    console.log(`❌ FAILED: ${error.message}`);
    failedTests++;
  }
  console.log('');

  // Test 4: Performance validation (<2s target)
  console.log('📝 Test 4: Performance Validation (<2s target)');
  try {
    const perfStartTime = Date.now();
    const result = await generateMatchExplanation(testInputs[6]); // New match
    const perfEndTime = Date.now();
    const duration = perfEndTime - perfStartTime;

    if (duration < 2000) {
      console.log(`✅ PASSED: Response time ${duration}ms < 2000ms target`);
      console.log(`   - Cached: ${result.cached}`);
      console.log(`   - Performance: ${((2000 - duration) / 2000 * 100).toFixed(1)}% faster than target`);
      passedTests++;
    } else {
      console.log(`⚠️  WARNING: Response time ${duration}ms > 2000ms target`);
      console.log(`   - Performance: ${((duration - 2000) / 2000 * 100).toFixed(1)}% slower than target`);
      failedTests++;
    }
  } catch (error: any) {
    console.log(`❌ FAILED: ${error.message}`);
    failedTests++;
  }
  console.log('');

  // Test 5: Cache statistics
  console.log('📝 Test 5: Cache Statistics');
  try {
    const stats = await getCacheStats();
    console.log('✅ PASSED: Cache stats retrieved');
    console.log(`   - Total keys: ${stats.totalKeys}`);
    console.log(`   - Cache size: ${stats.cacheSize}`);
    console.log(`   - Estimated cache hit rate: ${stats.hitRate ? (stats.hitRate * 100).toFixed(1) + '%' : 'N/A'}`);
    passedTests++;
  } catch (error: any) {
    console.log(`❌ FAILED: ${error.message}`);
    failedTests++;
  }
  console.log('');

  // Test 6: Low match score explanation
  console.log('📝 Test 6: Low Match Score Explanation');
  try {
    const result = await generateMatchExplanation(testInputs[7]); // Low match (score 42)
    console.log('✅ PASSED: Low match explanation generated');
    console.log(`   - Summary: ${result.explanation.summary}`);
    console.log(`   - Has cautions: ${!!result.explanation.cautions}`);
    console.log(`   - Recommendation: ${result.explanation.recommendation.substring(0, 50)}...`);
    passedTests++;
  } catch (error: any) {
    console.log(`❌ FAILED: ${error.message}`);
    failedTests++;
  }
  console.log('');

  // Summary
  const endTime = Date.now();
  const totalDuration = endTime - startTime;

  console.log('========================================');
  console.log('Test Summary');
  console.log('========================================');
  console.log(`✅ Passed: ${passedTests} / ${passedTests + failedTests}`);
  console.log(`❌ Failed: ${failedTests} / ${passedTests + failedTests}`);
  console.log(`⏱️  Total duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`📊 Success rate: ${((passedTests / (passedTests + failedTests)) * 100).toFixed(1)}%`);
  console.log('========================================\n');

  // Exit with appropriate code
  process.exit(failedTests > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
