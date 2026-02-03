/**
 * SME24 API Data Quality Diagnostic Script
 *
 * Analyzes raw API response to verify:
 * 1. Which fields are actually returned by the API
 * 2. Fill rates for eligibility criteria fields
 * 3. Correlation between supportInstitution and data quality
 *
 * Run with: npx tsx scripts/diagnose-sme24-api-data.ts
 */

import 'dotenv/config';
import { sme24Client } from '../lib/sme24-api/client';
import { SME24AnnouncementItem } from '../lib/sme24-api/types';

// Fields to analyze
const ELIGIBILITY_FIELDS = [
  'cmpScale', 'cmpScaleCd',           // Company scale
  'salsAmt', 'salsAmtCd',             // Sales/Revenue
  'emplyCnt', 'emplyCntCd',           // Employee count
  'ablbiz', 'ablbizCd',               // Business age
  'areaNm', 'areaCd',                 // Region
  'needCrtfn', 'needCrtfnCd',         // Required certifications
  'lifeCyclDvsn', 'lifeCyclDvsnCd',   // Lifecycle
  'induty',                            // Industry
  'minSportAmt', 'maxSportAmt',       // Support amount
  'minRpsntAge', 'maxRpsntAge',       // CEO age
] as const;

const CLASSIFICATION_FIELDS = [
  'bizType', 'bizTypeCd',             // Business type
  'sportType', 'sportTypeCd',         // Support type
  'sportInsttNm', 'sportInsttCd',     // Support institution
] as const;

interface FieldStats {
  total: number;
  filled: number;
  empty: number;
  fillRate: string;
  sampleValues: string[];
}

function analyzeFieldFillRates(items: SME24AnnouncementItem[]): Record<string, FieldStats> {
  const stats: Record<string, FieldStats> = {};

  const allFields = [...ELIGIBILITY_FIELDS, ...CLASSIFICATION_FIELDS];

  for (const field of allFields) {
    const filled = items.filter(item => {
      const value = (item as unknown as Record<string, unknown>)[field];
      if (value === null || value === undefined || value === '') return false;
      if (typeof value === 'string' && value.trim() === '') return false;
      return true;
    });

    const sampleValues = filled
      .slice(0, 5)
      .map(item => String((item as unknown as Record<string, unknown>)[field] || '').substring(0, 50))
      .filter(Boolean);

    stats[field] = {
      total: items.length,
      filled: filled.length,
      empty: items.length - filled.length,
      fillRate: ((filled.length / items.length) * 100).toFixed(1) + '%',
      sampleValues,
    };
  }

  return stats;
}

function analyzeByInstitution(items: SME24AnnouncementItem[]): Record<string, {
  count: number;
  withScaleCode: number;
  withSalesCode: number;
  withRegionCode: number;
}> {
  const byInstitution: Record<string, { count: number; withScaleCode: number; withSalesCode: number; withRegionCode: number }> = {};

  for (const item of items) {
    const inst = item.sportInsttNm || '(없음)';
    if (!byInstitution[inst]) {
      byInstitution[inst] = { count: 0, withScaleCode: 0, withSalesCode: 0, withRegionCode: 0 };
    }
    byInstitution[inst].count++;
    if (item.cmpScaleCd && item.cmpScaleCd.trim()) byInstitution[inst].withScaleCode++;
    if (item.salsAmtCd && item.salsAmtCd.trim()) byInstitution[inst].withSalesCode++;
    if (item.areaCd && item.areaCd.trim()) byInstitution[inst].withRegionCode++;
  }

  return byInstitution;
}

function printRawSamplePrograms(items: SME24AnnouncementItem[]) {
  console.log('\n' + '='.repeat(80));
  console.log('RAW API RESPONSE SAMPLES (3 programs with eligibility data, 3 without)');
  console.log('='.repeat(80));

  // Find programs WITH eligibility data
  const withEligibility = items.filter(item =>
    item.cmpScaleCd && item.cmpScaleCd.trim() !== ''
  ).slice(0, 3);

  // Find programs WITHOUT eligibility data
  const withoutEligibility = items.filter(item =>
    !item.cmpScaleCd || item.cmpScaleCd.trim() === ''
  ).slice(0, 3);

  console.log('\n--- PROGRAMS WITH ELIGIBILITY CODES ---');
  for (const item of withEligibility) {
    console.log(`\n[${item.pblancSeq}] ${item.pblancNm?.substring(0, 60)}...`);
    console.log(`  Institution: ${item.sportInsttNm || '(none)'}`);
    console.log(`  bizType: ${item.bizType} / bizTypeCd: ${item.bizTypeCd}`);
    console.log(`  cmpScale: "${item.cmpScale || ''}" / cmpScaleCd: "${item.cmpScaleCd || ''}"`);
    console.log(`  salsAmt: "${item.salsAmt || ''}" / salsAmtCd: "${item.salsAmtCd || ''}"`);
    console.log(`  emplyCnt: "${item.emplyCnt || ''}" / emplyCntCd: "${item.emplyCntCd || ''}"`);
    console.log(`  ablbiz: "${item.ablbiz || ''}" / ablbizCd: "${item.ablbizCd || ''}"`);
    console.log(`  areaNm: "${item.areaNm || ''}" / areaCd: "${item.areaCd || ''}"`);
    console.log(`  needCrtfn: "${item.needCrtfn || ''}" / needCrtfnCd: "${item.needCrtfnCd || ''}"`);
    console.log(`  lifeCyclDvsn: "${item.lifeCyclDvsn || ''}" / lifeCyclDvsnCd: "${item.lifeCyclDvsnCd || ''}"`);
    console.log(`  induty: "${item.induty || ''}"`);
    console.log(`  maxSportAmt: ${item.maxSportAmt ?? '(null)'}`);
  }

  console.log('\n--- PROGRAMS WITHOUT ELIGIBILITY CODES (기타 institution) ---');
  for (const item of withoutEligibility) {
    console.log(`\n[${item.pblancSeq}] ${item.pblancNm?.substring(0, 60)}...`);
    console.log(`  Institution: ${item.sportInsttNm || '(none)'}`);
    console.log(`  bizType: ${item.bizType} / bizTypeCd: ${item.bizTypeCd}`);
    console.log(`  cmpScale: "${item.cmpScale || ''}" / cmpScaleCd: "${item.cmpScaleCd || ''}"`);
    console.log(`  salsAmt: "${item.salsAmt || ''}" / salsAmtCd: "${item.salsAmtCd || ''}"`);
    console.log(`  emplyCnt: "${item.emplyCnt || ''}" / emplyCntCd: "${item.emplyCntCd || ''}"`);
    console.log(`  ablbiz: "${item.ablbiz || ''}" / ablbizCd: "${item.ablbizCd || ''}"`);
    console.log(`  areaNm: "${item.areaNm || ''}" / areaCd: "${item.areaCd || ''}"`);
    console.log(`  needCrtfn: "${item.needCrtfn || ''}" / needCrtfnCd: "${item.needCrtfnCd || ''}"`);
    console.log(`  lifeCyclDvsn: "${item.lifeCyclDvsn || ''}" / lifeCyclDvsnCd: "${item.lifeCyclDvsnCd || ''}"`);
    console.log(`  induty: "${item.induty || ''}"`);
    console.log(`  maxSportAmt: ${item.maxSportAmt ?? '(null)'}`);
    // Show supportTarget for text-based eligibility extraction potential
    const targetText = item.sportTrget?.replace(/<[^>]*>/g, '').substring(0, 200);
    if (targetText) {
      console.log(`  sportTrget (지원대상 text): "${targetText}..."`);
    }
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('SME24 API DATA QUALITY DIAGNOSTIC');
  console.log('='.repeat(80));
  console.log('');

  // Fetch last 7 days of data
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const formatDate = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  };

  console.log(`Fetching announcements from ${formatDate(sevenDaysAgo)} to ${formatDate(today)}...`);
  console.log('');

  const result = await sme24Client.fetchAnnouncements({
    strDt: formatDate(sevenDaysAgo),
    endDt: formatDate(today),
  });

  if (!result.success || !result.data) {
    console.error('API call failed:', result.error);
    process.exit(1);
  }

  const items = result.data;
  console.log(`Total programs fetched: ${items.length}`);
  console.log('');

  // 1. Field Fill Rate Analysis
  console.log('='.repeat(80));
  console.log('FIELD FILL RATE ANALYSIS');
  console.log('='.repeat(80));

  const stats = analyzeFieldFillRates(items);

  console.log('\n--- Classification Fields (Expected High Fill Rate) ---');
  for (const field of CLASSIFICATION_FIELDS) {
    const s = stats[field];
    const status = parseFloat(s.fillRate) >= 90 ? '✓' : parseFloat(s.fillRate) >= 50 ? '△' : '✗';
    console.log(`${status} ${field.padEnd(20)} ${s.fillRate.padStart(7)} (${s.filled}/${s.total})`);
    if (s.sampleValues.length > 0) {
      console.log(`    Sample: ${s.sampleValues.slice(0, 3).join(', ')}`);
    }
  }

  console.log('\n--- Eligibility Criteria Fields (CRITICAL FOR MATCHING) ---');
  for (const field of ELIGIBILITY_FIELDS) {
    const s = stats[field];
    const status = parseFloat(s.fillRate) >= 50 ? '✓' : parseFloat(s.fillRate) >= 10 ? '△' : '✗';
    console.log(`${status} ${field.padEnd(20)} ${s.fillRate.padStart(7)} (${s.filled}/${s.total})`);
    if (s.sampleValues.length > 0) {
      console.log(`    Sample: ${s.sampleValues.slice(0, 3).join(', ')}`);
    }
  }

  // 2. Analysis by Institution
  console.log('\n' + '='.repeat(80));
  console.log('ELIGIBILITY DATA BY SUPPORT INSTITUTION');
  console.log('='.repeat(80));

  const byInst = analyzeByInstitution(items);
  const sortedInst = Object.entries(byInst).sort((a, b) => b[1].count - a[1].count);

  console.log('\nInstitution'.padEnd(35) + 'Programs'.padStart(10) + 'w/Scale'.padStart(10) + 'w/Sales'.padStart(10) + 'w/Region'.padStart(10));
  console.log('-'.repeat(75));

  for (const [inst, data] of sortedInst) {
    const scaleRate = data.count > 0 ? `${((data.withScaleCode / data.count) * 100).toFixed(0)}%` : '0%';
    console.log(
      inst.substring(0, 33).padEnd(35) +
      String(data.count).padStart(10) +
      `${data.withScaleCode} (${scaleRate})`.padStart(10) +
      String(data.withSalesCode).padStart(10) +
      String(data.withRegionCode).padStart(10)
    );
  }

  // 3. Raw Sample Programs
  printRawSamplePrograms(items);

  // 4. Summary
  console.log('\n' + '='.repeat(80));
  console.log('DIAGNOSTIC SUMMARY');
  console.log('='.repeat(80));

  const totalWithEligibility = items.filter(i => i.cmpScaleCd && i.cmpScaleCd.trim()).length;
  const totalWithoutEligibility = items.length - totalWithEligibility;
  const gita = byInst['기타'] || { count: 0, withScaleCode: 0 };

  console.log(`
Total Programs: ${items.length}
  - With eligibility codes: ${totalWithEligibility} (${((totalWithEligibility / items.length) * 100).toFixed(1)}%)
  - Without eligibility codes: ${totalWithoutEligibility} (${((totalWithoutEligibility / items.length) * 100).toFixed(1)}%)

"기타" Institution Analysis:
  - Programs from "기타": ${gita.count} (${((gita.count / items.length) * 100).toFixed(1)}% of total)
  - With eligibility codes: ${gita.withScaleCode} (${gita.count > 0 ? ((gita.withScaleCode / gita.count) * 100).toFixed(1) : 0}%)

CONCLUSION:
${totalWithoutEligibility > items.length * 0.8
    ? '⚠️  CONFIRMED: The API returns EMPTY eligibility fields for most programs.\n   Programs from "기타" institutions do NOT have structured eligibility data.\n   This is a DATA SOURCE issue, not a sync/mapping issue.'
    : '✓ Eligibility data appears to be available for most programs.'}
`);

  console.log('='.repeat(80));
  console.log('Diagnostic complete.');
  console.log('='.repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
