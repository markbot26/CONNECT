/**
 * Verify that 치매의료기술연구개발사업 (BIO_HEALTH) is blocked for 이노웨이브 (ICT)
 * Tests both v4.3 and v6.0-funnel algorithms
 */

import { PrismaClient, ProgramStatus, AnnouncementType } from '@prisma/client';
import { generateMatches } from '../lib/matching/algorithm';
import { generateMatchesV6 } from '../lib/matching/v6/funnel';
import { evaluateEligibilityGate } from '../lib/matching/v6/eligibility-gate';

const db = new PrismaClient({ log: ['error', 'warn'] });

async function verify() {
  console.log('🧪 Verifying 치매의료기술연구개발사업 is BLOCKED for 이노웨이브\n');
  console.log('='.repeat(70));

  // Production: e81e467f-a84c-4a8d-ac57-b7527913c695
  // Local: a592e75b-9049-4352-a36c-991642cd4672
  const orgId = process.env.INNOWAVE_ORG_ID || 'a592e75b-9049-4352-a36c-991642cd4672';

  try {
    const organization = await db.organizations.findUnique({
      where: { id: orgId },
    });

    if (!organization) {
      console.log('❌ Organization not found!');
      return;
    }

    console.log('\n📋 Organization Profile:');
    console.log(`   Name: ${organization.name}`);
    console.log(`   Industry: ${organization.industrySector}`);
    console.log(`   Key Technologies: ${organization.keyTechnologies?.join(', ')}`);
    console.log(`   Tech Domains Specific: ${organization.technologyDomainsSpecific?.join(', ')}`);
    console.log(`   Research Focus Areas: ${organization.researchFocusAreas?.join(', ')}`);

    // Find the 치매 program
    const dementiaProgram = await db.funding_programs.findFirst({
      where: {
        title: { contains: '치매' },
        status: ProgramStatus.ACTIVE,
      },
    });

    if (!dementiaProgram) {
      console.log('\n❌ 치매 program not found in ACTIVE programs');
      return;
    }

    console.log('\n📋 Program Details:');
    console.log(`   Title: ${dementiaProgram.title}`);
    console.log(`   Status: ${dementiaProgram.status}`);
    console.log(`   Category: ${dementiaProgram.category}`);
    console.log(`   Category: ${dementiaProgram.category}`);
    console.log(`   Ministry: ${dementiaProgram.ministry}`);
    console.log(`   Keywords: ${dementiaProgram.keywords?.join(', ')}`);
    console.log(`   Deadline: ${dementiaProgram.deadline}`);
    console.log(`   Scraping Source: ${dementiaProgram.scrapingSource}`);
    console.log(`   Announcement Type: ${dementiaProgram.announcementType}`);

    // Test 1: v6 eligibility gate directly
    console.log('\n' + '='.repeat(70));
    console.log('TEST 1: v6 Eligibility Gate (Direct)\n');

    const gateResult = evaluateEligibilityGate(dementiaProgram as any, organization as any);
    console.log(`   Passed: ${gateResult.passed}`);
    console.log(`   Block Reasons: ${gateResult.blockReasons.join(', ') || 'NONE'}`);
    console.log(`   Eligibility Level: ${gateResult.eligibilityLevel}`);

    // Keyword overlap debug
    console.log('\n   🔍 Keyword Overlap Debug:');
    const orgKeywords = [
      ...(organization.keyTechnologies || []),
      ...(organization.technologyDomainsSpecific || []),
      ...(organization.researchFocusAreas || []),
    ].map(k => k.toLowerCase());
    console.log(`   Org keywords: [${orgKeywords.join(', ')}]`);

    const programKeywords = (dementiaProgram.keywords || []).map(k => k.toLowerCase());
    const programTitleWords = dementiaProgram.title.toLowerCase().split(/\s+/)
      .filter(word => word.length >= 2);
    const allProgramKeywords = [...programKeywords, ...programTitleWords];
    console.log(`   Program keywords: [${allProgramKeywords.join(', ')}]`);

    // Check exact matches
    const exactMatches = orgKeywords.filter(orgK =>
      allProgramKeywords.some(progK => orgK === progK)
    );
    console.log(`   Exact matches (===): [${exactMatches.join(', ')}]`);

    // Check substring matches (the OLD buggy way)
    const substringMatches = orgKeywords.filter(orgK =>
      allProgramKeywords.some(progK => orgK.includes(progK) || progK.includes(orgK))
    );
    console.log(`   Substring matches (includes): [${substringMatches.join(', ')}]`);

    // Test 2: v6 full funnel with just the 치매 program
    console.log('\n' + '='.repeat(70));
    console.log('TEST 2: v6 Full Funnel (치매 only)\n');

    const v6Results = generateMatchesV6(organization as any, [dementiaProgram] as any[], 10, { minimumScore: 0 });
    console.log(`   v6 matches: ${v6Results.length}`);
    if (v6Results.length > 0) {
      v6Results.forEach(m => console.log(`   ❌ UNEXPECTED: Score ${m.score} - ${m.program.title}`));
    } else {
      console.log(`   ✅ BLOCKED: 치매 program correctly filtered out`);
    }

    // Test 3: v4.3 algorithm with just the 치매 program
    console.log('\n' + '='.repeat(70));
    console.log('TEST 3: v4.3 Algorithm (치매 only)\n');

    const v43Results = generateMatches(organization as any, [dementiaProgram] as any[], 10, { minimumScore: 0 });
    console.log(`   v4.3 matches: ${v43Results.length}`);
    if (v43Results.length > 0) {
      v43Results.forEach(m => console.log(`   ❌ UNEXPECTED: Score ${m.score} - ${m.program.title}`));
    } else {
      console.log(`   ✅ BLOCKED: 치매 program correctly filtered out`);
    }

    // Test 4: Full match generation with v6
    console.log('\n' + '='.repeat(70));
    console.log('TEST 4: Full v6 Match Generation (all ACTIVE programs)\n');

    const allActivePrograms = await db.funding_programs.findMany({
      where: {
        status: ProgramStatus.ACTIVE,
        announcementType: AnnouncementType.R_D_PROJECT,
        OR: [
          { deadline: null },
          { deadline: { gte: new Date() } },
        ],
      },
    });
    console.log(`   Programs queried (with deadline filter): ${allActivePrograms.length}`);

    const hasDementia = allActivePrograms.some(p => p.title.includes('치매'));
    console.log(`   치매 program in query results: ${hasDementia ? '⚠️ YES' : '✅ NO (filtered by deadline)'}`);

    const fullV6Results = generateMatchesV6(organization as any, allActivePrograms as any[], 20, { minimumScore: 55 });
    console.log(`   v6 total matches: ${fullV6Results.length}`);

    const dementiaInResults = fullV6Results.some(m => m.program.title.includes('치매'));
    console.log(`   치매 in final results: ${dementiaInResults ? '❌ STILL MATCHED (BUG!)' : '✅ NOT MATCHED (CORRECT)'}`);

    if (fullV6Results.length > 0) {
      console.log('\n   Top matches:');
      fullV6Results.slice(0, 10).forEach((m, i) => {
        console.log(`   ${i + 1}. [${m.score}pts] ${m.program.title.substring(0, 55)}`);
      });
    }

    // FINAL VERDICT
    console.log('\n' + '='.repeat(70));
    console.log('📋 FINAL VERDICT\n');
    if (!gateResult.passed && !dementiaInResults) {
      console.log('✅ ALL CHECKS PASSED: 치매 program is correctly blocked');
    } else {
      console.log('❌ BUG STILL EXISTS:');
      if (gateResult.passed) console.log('   - Eligibility gate did NOT block');
      if (dementiaInResults) console.log('   - 치매 still appears in final results');
    }

  } catch (error: any) {
    console.error('\n❌ ERROR:', error.message);
    console.error('   Stack:', error.stack);
  } finally {
    await db.$disconnect();
  }
}

verify();
