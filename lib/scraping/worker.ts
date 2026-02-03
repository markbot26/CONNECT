/**
 * Scraping Worker (with Cache Invalidation)
 *
 * Bull queue worker that processes scraping jobs for 4 NTIS agencies.
 * Uses Playwright for browser automation and change detection via SHA-256 hashing.
 *
 * Cache invalidation:
 * - After successful scraping: Invalidates programs cache and all match caches
 * - Ensures users get fresh matches after new programs are added
 */

import { Worker, Job } from 'bullmq';
import { chromium, Browser, Page } from 'playwright';
import { db } from '@/lib/db';
import { AgencyId } from '@prisma/client';
import {
  RateLimiter,
  generateProgramHash,
  logScraping,
  getRandomUserAgent,
  parseKoreanDate,
} from './utils';
import { getDailyScrapeDateRange } from './utils/date-utils';
import { applyNTISDateFilter } from './utils/ntis-date-filter';
import { scrapingConfig, AgencyConfig } from './config';
import { sendNewMatchNotification } from '../email/notifications';
import { parseProgramDetails, ProgramDetails } from './parsers';
import {
  invalidateProgramsCache,
  invalidateAllMatches,
} from '@/lib/cache/redis-cache';
import { startScheduler } from './scheduler';
import { startNTISScheduler } from '../ntis-api/scheduler';
import { initializeCacheScheduler } from '../cache/init';
import { classifyAnnouncement } from './classification';
import { startProcessWorkerScheduler } from './process-worker-scheduler';
import { startEmailCronJobs } from '../email/cron';
// NOTE: LLM semantic enrichment removed in v4.0 - replaced by keyword-based classification
// See lib/matching/keyword-classifier.ts for the new deterministic approach


// Job data interface
interface ScrapingJobData {
  agency: string;
  url: string;
  config: AgencyConfig;
  priority?: 'high' | 'standard';
}

// Result interface
interface ScrapingResult {
  agency: string;
  success: boolean;
  programsFound: number;
  programsNew: number;
  programsUpdated: number;
  timestamp: Date;
  error?: string;
}

/**
 * Extract top-level eligibility fields from JSONB eligibilityCriteria
 *
 * The matching algorithm requires eligibility data in top-level fields
 * (e.g., requiredInvestmentAmount as Decimal) while the parser saves extracted
 * data to nested JSONB structure (e.g., eligibilityCriteria.financialRequirements.investmentThreshold.minimumAmount).
 *
 * This function bridges the gap by extracting values from JSONB and promoting
 * them to top-level fields for the matching algorithm.
 *
 * @param eligibilityCriteria - JSONB object from parser (may be undefined)
 * @returns Object with top-level eligibility fields for database insertion
 */
function extractEligibilityFields(eligibilityCriteria: any) {
  const fields = {
    requiredInvestmentAmount: null as number | null,
    requiredOperatingYears: null as number | null,
    maxOperatingYears: null as number | null,
    requiredMinEmployees: null as number | null,
    requiredMaxEmployees: null as number | null,
    requiredCertifications: [] as string[],
    preferredCertifications: [] as string[],
  };

  if (!eligibilityCriteria) {
    return fields;
  }

  try {
    // Extract investment threshold from financialRequirements
    const financialReqs = eligibilityCriteria.financialRequirements;
    if (financialReqs?.investmentThreshold?.minimumAmount) {
      fields.requiredInvestmentAmount = financialReqs.investmentThreshold.minimumAmount;
    }

    // Extract operating years from organizationRequirements
    const orgReqs = eligibilityCriteria.organizationRequirements;
    if (orgReqs?.operatingYears) {
      if (orgReqs.operatingYears.minimum) {
        fields.requiredOperatingYears = orgReqs.operatingYears.minimum;
      }
      if (orgReqs.operatingYears.maximum) {
        fields.maxOperatingYears = orgReqs.operatingYears.maximum;
      }
    }

    // Extract employee count from organizationRequirements
    // Note: Employee count constraints are not in current JSONB structure
    // Future enhancement if needed

    // Extract certifications from certificationRequirements
    const certReqs = eligibilityCriteria.certificationRequirements;
    if (certReqs?.required && Array.isArray(certReqs.required) && certReqs.required.length > 0) {
      fields.requiredCertifications = certReqs.required;
    }
    if (certReqs?.preferred && Array.isArray(certReqs.preferred) && certReqs.preferred.length > 0) {
      fields.preferredCertifications = certReqs.preferred;
    }
  } catch (error) {
    console.error('[WORKER] Failed to extract eligibility fields from JSONB:', error);
    // Return empty fields on error (safer than failing the entire program creation)
  }

  return fields;
}

// NOTE: enrichProgramWithSemantics function removed in v4.0
// LLM semantic enrichment had 61% failure rate with ~₩27/program cost
// Replaced by deterministic keyword classification in lib/matching/keyword-classifier.ts
// which provides 100% coverage at ₩0 cost and <10ms processing time

/**
 * Main scraping worker
 */
export const scrapingWorker = new Worker<ScrapingJobData, ScrapingResult>(
  'scraping-queue',
  async (job: Job<ScrapingJobData>) => {
    const { agency, url, config } = job.data;

    logScraping(agency, `Starting scrape job ${job.id}...`);

    let browser: Browser | null = null;

    try {
      // 1. Launch Playwright browser
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
        ],
      });

      // 2. Create context with stealth settings
      const context = await browser.newContext({
        userAgent:
          process.env.SCRAPER_USER_AGENT ||
          'Mozilla/5.0 (compatible; ConnectBot/1.0; +https://connect.kr/bot)',
        viewport: {
          width: 1280 + Math.floor(Math.random() * 100),
          height: 800 + Math.floor(Math.random() * 100),
        },
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        extraHTTPHeaders: {
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          Connection: 'keep-alive',
        },
      });

      const page = await context.newPage();
      page.setDefaultTimeout(config.timeout || 30000);

      // Remove webdriver flag (using addInitScript for newer Playwright)
      await page.addInitScript(() => {
        delete (Object.getPrototypeOf(navigator) as any).webdriver;
      });

      // 3. Navigate to agency listings page
      // NTIS-specific: Apply date filter before extracting announcements
      if (agency.toLowerCase() === 'ntis') {
        // Calculate rolling date window (last N days)
        const daysBack = parseInt(process.env.NTIS_SCRAPING_DAYS_BACK || '2');
        const { fromDate, toDate } = getDailyScrapeDateRange(daysBack);

        logScraping(
          agency,
          `Applying date filter: ${fromDate} to ${toDate} (${daysBack} days back)`
        );

        // Apply date filter using jQuery datepicker form submission
        await applyNTISDateFilter(page, { fromDate, toDate, pageNum: 1 });

        logScraping(agency, `✓ Date filter applied successfully`);
      } else {
        // Other agencies: Navigate normally
        logScraping(agency, `Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'networkidle', timeout: config.timeout });
      }

      // 4. Extract announcements from listing page (now filtered by date for NTIS)
      const announcements = await extractAnnouncements(page, config, agency);
      logScraping(agency, `Found ${announcements.length} announcements`);

      // 5. Sanity check: Warn if suspiciously low results for NTIS
      if (announcements.length === 0 && agency.toLowerCase() === 'ntis') {
        // Check if we've successfully scraped NTIS programs in the last 7 days
        const recentCount = await db.funding_programs.count({
          where: {
            agencyId: 'NTIS',
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        });

        if (recentCount > 0) {
          throw new Error(
            'NTIS returned 0 announcements (possible maintenance window or filter error). Triggering retry.'
          );
        }
      }

      // 5. Process each announcement
      const rateLimiter = new RateLimiter(config.rateLimit.requestsPerMinute);
      let programsNew = 0;
      let programsUpdated = 0;

      for (const announcement of announcements) {
        try {
          // Rate limiting
          await rateLimiter.throttle();

          // Generate content hash for change detection (V2: title-based, not URL-based)
          const contentHash = generateProgramHash({
            agencyId: agency,
            title: announcement.title,
            deadline: announcement.deadline,
            ministry: announcement.ministry,
          });

          // Check if program already exists
          const existingProgram = await db.funding_programs.findFirst({
            where: { contentHash },
          });

          if (!existingProgram) {
            // NEW PROGRAM
            logScraping(agency, `New program: ${announcement.title.substring(0, 50)}...`);

            // OPTIMIZATION: Parse deadline from NTIS list page (if available)
            // This avoids fetching detail page in 95% of cases
            let listPageDeadline: Date | null = null;
            if (announcement.deadline) {
              listPageDeadline = parseKoreanDate(announcement.deadline);
              if (listPageDeadline) {
                logScraping(
                  agency,
                  `✓ Parsed deadline from list page: ${announcement.deadline} → ${listPageDeadline.toISOString()}`
                );
              }
            }

            // Fetch detail page for additional metadata
            const details = await fetchProgramDetails(
              page,
              announcement.link,
              config,
              agency,
              announcement.title // Pass title for NTIS classification (fixes Nuclear→ICT bug)
            );

            // CLASSIFICATION: Determine announcement type (R&D funding vs survey/event/notice)
            const announcementType = classifyAnnouncement({
              title: announcement.title,
              description: details.description || '',
              url: announcement.link,
              source: agency.toLowerCase() as 'iitp' | 'tipa' | 'kimst' | 'ntis',
            });

            // Log classification decision for debugging/auditing
            logScraping(
              agency,
              `Classified as ${announcementType}: ${announcement.title.substring(0, 60)}...`
            );

            // Convert targetType string to array format for Prisma
            const targetTypeArray =
              details.targetType === 'BOTH'
                ? ['COMPANY' as const, 'RESEARCH_INSTITUTE' as const]
                : details.targetType === 'COMPANY'
                ? ['COMPANY' as const]
                : details.targetType === 'RESEARCH_INSTITUTE'
                ? ['RESEARCH_INSTITUTE' as const]
                : ['COMPANY' as const, 'RESEARCH_INSTITUTE' as const]; // Default to BOTH

            // Extract top-level eligibility fields from JSONB for matching algorithm
            // The matching algorithm checks these top-level fields (e.g., requiredInvestmentAmount)
            // while the extracted data is in eligibilityCriteria JSONB (e.g., eligibilityCriteria.financialRequirements.investmentThreshold.minimumAmount)
            const eligibilityFields = extractEligibilityFields(details.eligibilityCriteria);

            // Create new program
            const newProgram = await db.funding_programs.create({
              data: {
                agencyId: agency.toUpperCase() as AgencyId,
                title: announcement.title,
                description: details.description || null,
                announcementUrl: announcement.link,
                // Prioritize list page deadline (95% success rate), fall back to detail page
                deadline: listPageDeadline || details.deadline || null,
                budgetAmount: details.budgetAmount || null,
                targetType: targetTypeArray,
                minTrl: details.minTRL || null,
                maxTrl: details.maxTRL || null,
                // @ts-ignore - trlConfidence added via migration but not yet in Prisma types
                trlConfidence: details.trlConfidence || 'missing',
                // @ts-ignore - trlClassification added via migration but not yet in Prisma types
                trlClassification: details.trlClassification || undefined,
                eligibilityCriteria: details.eligibilityCriteria || undefined,
                // Top-level eligibility fields extracted from JSONB for matching algorithm
                requiredInvestmentAmount: eligibilityFields.requiredInvestmentAmount,
                requiredOperatingYears: eligibilityFields.requiredOperatingYears,
                maxOperatingYears: eligibilityFields.maxOperatingYears,
                requiredMinEmployees: eligibilityFields.requiredMinEmployees,
                requiredMaxEmployees: eligibilityFields.requiredMaxEmployees,
                requiredCertifications: eligibilityFields.requiredCertifications,
                preferredCertifications: eligibilityFields.preferredCertifications,
                publishedAt: details.publishedAt ?? null, // 공고일 (only NTIS provides this)
                ministry: details.ministry || null, // 부처명 (extracted from NTIS announcements)
                announcingAgency: details.announcingAgency || null, // 공고기관명 (extracted from NTIS announcements)
                category: details.category || null, // Industry sector (extracted from agency)
                keywords: details.keywords || [], // Technology keywords (agency defaults + extracted from title/description)
                // Note: attachmentUrls and trlInferred not in ProgramDetails interface - will use Prisma defaults
                contentHash,
                scrapedAt: new Date(),
                scrapingSource: agency.toLowerCase(), // Agency ID: tipa, iitp, keit, kimst, ntis
                status: 'ACTIVE',
                announcementType, // ✅ Dynamic classification (was hardcoded 'R_D_PROJECT')
              },
            });

            programsNew++;

            // NOTE: LLM semantic enrichment removed in v4.0
            // Programs are now classified using deterministic keyword rules
            // at match-time via lib/matching/keyword-classifier.ts

            // Trigger match calculation (async, don't wait)
            calculateMatchesForProgram(newProgram.id).catch((err) =>
              console.error(`Match calculation failed for program ${newProgram.id}:`, err)
            );

            // Trigger email notifications for high-score matches (async, don't wait)
            sendMatchNotifications(newProgram.id).catch((err) =>
              console.error(`Match notifications failed for program ${newProgram.id}:`, err)
            );
          } else {
            // Existing program - update scrapedAt
            await db.funding_programs.update({
              where: { id: existingProgram.id },
              data: { scrapedAt: new Date() },
            });

            programsUpdated++;
          }
        } catch (err: any) {
          logScraping(
            agency,
            `Failed to process announcement: ${err.message}`,
            'error'
          );
          // Continue to next announcement
        }
      }

      await browser.close();

      // 6. Log result to database
      const completedAt = new Date();
      const startedAt = new Date(job.timestamp); // Job start time

      await db.scraping_logs.create({
        data: {
          agencyId: agency.toUpperCase() as AgencyId,
          success: true,
          programsFound: announcements.length,
          programsNew,
          programsUpdated,
          startedAt,
          completedAt,
          duration: completedAt.getTime() - startedAt.getTime(),
        },
      });

      logScraping(
        agency,
        `Scraping completed: ${programsNew} new, ${programsUpdated} updated`
      );

      // 7. Invalidate caches (programs and matches need refresh)
      if (programsNew > 0 || programsUpdated > 0) {
        logScraping(agency, 'Invalidating programs and match caches...');
        await invalidateProgramsCache();
        const matchesInvalidated = await invalidateAllMatches();
        logScraping(
          agency,
          `Cache invalidated: programs + ${matchesInvalidated} match caches`
        );
      }

      return {
        agency,
        success: true,
        programsFound: announcements.length,
        programsNew,
        programsUpdated,
        timestamp: new Date(),
      };
    } catch (error: any) {
      logScraping(agency, `Scraping failed: ${error.message}`, 'error');

      if (browser) {
        await browser.close();
      }

      // Log failure to database
      const completedAt = new Date();
      const startedAt = new Date(job.timestamp);

      await db.scraping_logs.create({
        data: {
          agencyId: agency.toUpperCase() as AgencyId,
          success: false,
          programsFound: 0,
          programsNew: 0,
          programsUpdated: 0,
          error: error.message,
          startedAt,
          completedAt,
          duration: completedAt.getTime() - startedAt.getTime(),
        },
      });

      throw error; // Re-throw for Bull retry logic
    }
  },
  {
    connection: {
      host: process.env.REDIS_QUEUE_HOST || 'localhost',
      port: parseInt(process.env.REDIS_QUEUE_PORT || '6380'),
    },
    concurrency: 2, // Max 2 simultaneous scraping jobs
  }
);

/**
 * Normalize URL to absolute format
 * Converts relative URLs to absolute using baseUrl
 */
function normalizeUrl(href: string, baseUrl: string): string {
  if (!href) return '';

  // Already absolute URL
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href;
  }

  // Relative URL - prepend baseUrl
  const separator = href.startsWith('/') ? '' : '/';
  return baseUrl + separator + href;
}

/**
 * Extract announcements from listing page
 * Returns basic data (title + link) + optional NTIS list page columns
 */
async function extractAnnouncements(
  page: Page,
  config: AgencyConfig,
  agency: string
): Promise<
  Array<{
    title: string;
    link: string;
    // Optional NTIS list page fields (only populated for NTIS agency)
    ntisId?: string;
    status?: string;
    ministry?: string;
    startDate?: string;
    deadline?: string;
    dday?: string;
  }>
> {
  const announcements = await page.$$eval(
    config.selectors.announcementList,
    (elements, selectors) => {
      return elements.map((el) => {
        const titleEl = el.querySelector(selectors.title);
        const linkEl = el.querySelector(selectors.link);

        // Base fields (required for all agencies)
        const announcement: any = {
          title: titleEl?.textContent?.trim() || '',
          link: linkEl?.getAttribute('href') || '',
        };

        // NTIS-specific list page fields (optional)
        if (selectors.ntisId) {
          const ntisIdEl = el.querySelector(selectors.ntisId);
          announcement.ntisId = ntisIdEl?.textContent?.trim();
        }
        if (selectors.status) {
          const statusEl = el.querySelector(selectors.status);
          announcement.status = statusEl?.textContent?.trim();
        }
        if (selectors.ministry) {
          const ministryEl = el.querySelector(selectors.ministry);
          announcement.ministry = ministryEl?.textContent?.trim();
        }
        if (selectors.startDate) {
          const startDateEl = el.querySelector(selectors.startDate);
          announcement.startDate = startDateEl?.textContent?.trim();
        }
        if (selectors.deadline) {
          const deadlineEl = el.querySelector(selectors.deadline);
          announcement.deadline = deadlineEl?.textContent?.trim();
        }
        if (selectors.dday) {
          const ddayEl = el.querySelector(selectors.dday);
          announcement.dday = ddayEl?.textContent?.trim();
        }

        return announcement;
      });
    },
    config.selectors
  );

  // Filter out empty titles/links and normalize URLs to absolute format
  return announcements
    .filter((a) => a.title && a.link)
    .map((a) => ({
      ...a,
      link: normalizeUrl(a.link, config.baseUrl),
    }));
}

/**
 * Fetch detailed program information using agency-specific parsers
 */
async function fetchProgramDetails(
  page: Page,
  link: string,
  config: AgencyConfig,
  agency: string,
  announcementTitle?: string // Title from listing page (needed for NTIS classification)
): Promise<ProgramDetails> {
  try {
    // Navigate to detail page
    const fullUrl = link.startsWith('http') ? link : config.baseUrl + link;

    // Use agency-specific parser
    const details = await parseProgramDetails(page, agency, fullUrl, announcementTitle);

    logScraping(
      agency,
      `Parsed details: deadline=${details.deadline ? 'found' : 'none'}, budget=${details.budgetAmount ? 'found' : 'none'}, targetType=${details.targetType}`
    );

    return details;
  } catch (err: any) {
    logScraping(agency, `Failed to fetch details: ${err.message}`, 'warn');
    return {
      description: null,
      deadline: null,
      budgetAmount: null,
      targetType: 'BOTH',
      minTRL: null,
      maxTRL: null,
      eligibilityCriteria: null,
      publishedAt: null,
    };
  }
}

/**
 * Send email notifications for new high-score matches
 */
async function sendMatchNotifications(programId: string): Promise<void> {
  try {
    // Get all matches for this program with score >= 70
    const highScoreMatches = await db.funding_matches.findMany({
      where: {
        programId,
        score: { gte: 70 }, // Only high-score matches
      },
      include: {
        organizations: {
          include: {
            users: {
              select: { id: true },
            },
          },
        },
      },
    });

    // Group matches by user
    const matchesByUser = new Map<string, string[]>();

    for (const match of highScoreMatches) {
      for (const user of match.organizations.users) {
        if (!matchesByUser.has(user.id)) {
          matchesByUser.set(user.id, []);
        }
        matchesByUser.get(user.id)!.push(match.id);
      }
    }

    // Send notifications to each user
    for (const [userId, matchIds] of matchesByUser.entries()) {
      try {
        await sendNewMatchNotification(userId, matchIds);
      } catch (err) {
        console.error(`Failed to send notification to user ${userId}:`, err);
      }
    }
  } catch (error) {
    console.error('Failed to send match notifications:', error);
  }
}

/**
 * Calculate matches for a newly scraped program
 */
async function calculateMatchesForProgram(programId: string): Promise<void> {
  const matchingAlgorithm = process.env.MATCHING_ALGORITHM || 'v4.3';

  if (matchingAlgorithm === 'v7-llm') {
    const { runV7MatchingForProgram } = await import('@/lib/matching/v7-llm/orchestrator');
    await runV7MatchingForProgram(programId);
    return;
  }

  // Get all active organizations
  const organizations = await db.organizations.findMany({
    where: { status: 'ACTIVE' },
  });

  const program = await db.funding_programs.findUnique({
    where: { id: programId },
  });

  if (!program) return;

  for (const org of organizations) {
    // Simple matching logic (from Phase 2A)
    let score = 0;
    const explanation: string[] = [];

    // Target type matching (40 points)
    if (
      (program.targetType.includes('COMPANY' as any) && program.targetType.includes('RESEARCH_INSTITUTE' as any)) ||
      program.targetType.includes(org.type)
    ) {
      score += 40;
      explanation.push('조직 유형이 적합합니다');
    }

    // Industry matching (20 points) - simplified
    if (program.title.includes(org.industrySector || '')) {
      score += 20;
      explanation.push('산업 분야가 일치합니다');
    }

    // R&D experience (20 points)
    if (org.rdExperience) {
      score += 20;
      explanation.push('R&D 경험이 있습니다');
    }

    // Only create match if score >= 60
    if (score >= 60) {
      await db.funding_matches.upsert({
        where: {
          organizationId_programId: {
            organizationId: org.id,
            programId: program.id,
          },
        },
        create: {
          organizationId: org.id,
          programId: program.id,
          score,
          explanation,
        },
        update: {
          score,
          explanation,
        },
      });
    }
  }
}

/**
 * Worker event handlers
 */
scrapingWorker.on('completed', (job, result) => {
  logScraping(
    result.agency,
    `Job ${job.id} completed: ${result.programsNew} new, ${result.programsUpdated} updated`
  );
});

scrapingWorker.on('failed', (job, err) => {
  if (job) {
    logScraping(job.data.agency, `Job ${job.id} failed: ${err.message}`, 'error');
  }
});

/**
 * Wait for Redis connection to stabilize after container start
 * Handles transient DNS resolution failures during Docker service discovery
 */
async function waitForRedis(retries = 5, delay = 3000): Promise<boolean> {
  const { Queue } = await import('bullmq');
  const testQueue = new Queue('connection-test', {
    connection: {
      host: process.env.REDIS_QUEUE_HOST || 'localhost',
      port: parseInt(process.env.REDIS_QUEUE_PORT || '6380'),
    },
  });

  for (let i = 0; i < retries; i++) {
    try {
      await testQueue.client;
      console.log('  ✅ Redis connection established');
      await testQueue.close();
      return true;
    } catch (err) {
      console.log(`  ⏳ Waiting for Redis... (attempt ${i + 1}/${retries})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  await testQueue.close();
  throw new Error('Failed to connect to Redis after retries');
}

// Start schedulers on worker initialization with startup delay
(async () => {
  console.log('🚀 Initializing schedulers...');

  try {
    // Wait for Redis to be available (DNS resolution may take time after container start)
    await waitForRedis();

    startScheduler();                   // Discovery Scraper (10 AM + 2 PM KST = 01:00 + 05:00 UTC)
    startProcessWorkerScheduler();      // Process Worker (event-driven, auto-start after Discovery)
    // startNTISScheduler();            // NTIS API scraper (completed/in-progress projects only) - NOT announcements
    initializeCacheScheduler();         // Cache warming (6 AM KST = 21:00 UTC)

    // Start email notification cron jobs (deadline reminders + weekly digest)
    // Graceful failure if SMTP not configured (non-critical for scraping operations)
    try {
      startEmailCronJobs();
      console.log('✅ Email notification cron jobs started');
      console.log('  - Deadline Reminders: 8 AM KST daily (23:00 UTC)');
      console.log('  - Weekly Digest: 8 AM KST Sundays (23:00 UTC)');
    } catch (emailError: any) {
      console.warn('⚠️  Email notifications disabled:', emailError.message);
      console.warn('   (This is non-critical - scraping will continue)');
    }

    console.log('✅ Schedulers initialized successfully');
    console.log('  - Discovery Scraper: 10 AM + 2 PM KST (01:00 + 05:00 UTC)');
    console.log('  - Process Worker: Event-driven (auto-start after Discovery)');
    console.log('  - Cache Warming: 6 AM KST (21:00 UTC)');
  } catch (err: any) {
    console.error('❌ Failed to initialize schedulers:', err.message);
    process.exit(1);
  }
})();

export default scrapingWorker;
