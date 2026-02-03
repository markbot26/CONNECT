/**
 * Match Generation API (with Redis Caching)
 *
 * Core feature: Generate funding opportunity matches for organizations
 *
 * Rate limiting enforced:
 * - Free tier: 2 API calls/month (max 3 matches per call)
 * - Pro tier: Unlimited (max 10 matches per call)
 * - Team tier: Unlimited (max 15 matches per call)
 *
 * Match filtering:
 * - Uses user's minimumMatchScore from notification settings (default: 60)
 * - Only returns matches above the user's threshold
 *
 * Caching strategy:
 * - Match results: 24h TTL (invalidated on profile update or new programs)
 * - Organization profiles: 1h TTL (invalidated on profile update)
 * - Active programs: 6h TTL (invalidated after scraping)
 *
 * POST /api/matches/generate?organizationId=xxx
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth.config';
import { PrismaClient, ProgramStatus, AnnouncementType } from '@prisma/client';

// Direct Prisma Client instantiation (bypasses lib/db module resolution issue)
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
};

const db = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error'],
});

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = db;
}
import { generateMatches, MATCH_ALGORITHM_VERSION } from '@/lib/matching/algorithm';
import { generateMatchesV6 } from '@/lib/matching/v6/funnel';
import { generateExplanation } from '@/lib/matching/explainer';
import { generateV6Explanation } from '@/lib/matching/v6/explainer';
import { checkMatchLimit, trackApiUsage } from '@/lib/rateLimit';
import { isShadowModeEnabled, type IdealApplicantProfile } from '@/lib/matching/ideal-profile';
import { calculateProximityScore, PROXIMITY_ALGORITHM_VERSION } from '@/lib/matching/proximity-scorer';
import {
  getCache,
  setCache,
  getMatchCacheKey,
  getOrgCacheKey,
  getProgramsCacheKey,
  CACHE_TTL,
  invalidateOrgMatches,
} from '@/lib/cache/redis-cache';
import { logMatchQualityBulk } from '@/lib/analytics/match-performance';
import { logFunnelEvent, hasFunnelEvent, AuditAction } from '@/lib/audit';
import { generatePersonalizedMatches, type MatchWithScore } from '@/lib/personalization';
import { loadActivePersonalizationConfig } from '@/lib/personalization/config-loader';
import type { MatchScore } from '@/lib/matching/algorithm';
import type { V6MatchScore } from '@/lib/matching/v6/types';

// Plan-based match limits per API call
const MAX_MATCHES_BY_PLAN: Record<string, number> = {
  free: 3,
  pro: 10,
  team: 15,
};

// Notification settings interface (matches dashboard settings)
interface NotificationSettings {
  newMatchNotifications?: boolean;
  deadlineReminders?: boolean;
  weeklyDigest?: boolean;
  minimumMatchScore?: number; // 0-100, default 60
  emailEnabled?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // 2. Get organization ID from query params
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId');
    const forceRegenerate = searchParams.get('forceRegenerate') === 'true';
    const matchingAlgorithm = process.env.MATCHING_ALGORITHM || 'v4.3';

    if (!organizationId) {
      return NextResponse.json(
        { error: 'Missing organizationId parameter' },
        { status: 400 }
      );
    }

    // 2a. Force regeneration if requested (safety mechanism)
    if (forceRegenerate) {
      // Clear cache and delete all existing matches
      await invalidateOrgMatches(organizationId);
      await db.funding_matches.deleteMany({
        where: { organizationId },
      });
      console.log('[MATCH] Force regeneration - cleared cache and database matches for org:', organizationId);
    }

    // 2b. Check cache for existing match results (24h TTL)
    const matchCacheKey = getMatchCacheKey(organizationId);
    const cachedMatches = await getCache<any>(matchCacheKey);

    if (cachedMatches && cachedMatches.algorithmVersion === matchingAlgorithm) {
      // Cache hit! Return cached matches immediately
      // But we need to fetch current usage stats for consistent response shape
      const user = await db.user.findUnique({
        where: { id: userId },
        include: { subscriptions: true },
      });

      const plan = user?.subscriptions?.plan;
      const subscriptionPlan = (plan ? plan.toLowerCase() : 'free') as 'free' | 'pro' | 'team';
      const currentUsage = await checkMatchLimit(userId, subscriptionPlan);

      return NextResponse.json(
        {
          ...cachedMatches,
          usage: {
            plan: subscriptionPlan,
            matchesUsed: 2 - currentUsage.remaining,
            matchesRemaining: currentUsage.remaining,
            resetDate: currentUsage.resetDate.toISOString(),
          },
          cached: true,
          cacheTimestamp: new Date().toISOString(),
        },
        { status: 200 }
      );
    }
    if (cachedMatches && cachedMatches.algorithmVersion !== matchingAlgorithm) {
      await invalidateOrgMatches(organizationId);
    }
    // Cache miss — likely algorithm version upgrade or TTL expiry.
    // Clean stale DB matches so GET /api/matches won't serve outdated records.
    const staleCleanup = await db.funding_matches.deleteMany({
      where: { organizationId },
    });
    if (staleCleanup.count > 0) {
      console.log(`[MATCH] Cache miss cleanup: deleted ${staleCleanup.count} stale DB matches for org:`, organizationId);
    }

    // 3. Fetch organization profile (with cache)
    const orgCacheKey = getOrgCacheKey(organizationId);
    let organization = await getCache<any>(orgCacheKey);

    if (!organization) {
      // Cache miss - fetch from database
      organization = await db.organizations.findUnique({
        where: { id: organizationId },
        include: {
          users: {
            where: { id: userId },
          },
          locations: true, // Required for 중소벤처기업부 regional matching
        },
      });

      if (organization) {
        // Cache organization profile for 1 hour
        await setCache(orgCacheKey, organization, CACHE_TTL.ORG_PROFILE);
      }
    }

    if (!organization) {
      return NextResponse.json(
        { error: 'Organization not found' },
        { status: 404 }
      );
    }

    // 4. Check if user owns this organization
    if (organization.users.length === 0) {
      return NextResponse.json(
        { error: 'You do not have access to this organization' },
        { status: 403 }
      );
    }

    // 5. Check if profile is complete
    if (!organization.profileCompleted) {
      return NextResponse.json(
        {
          error: 'Please complete your organization profile before generating matches',
          profileComplete: false,
        },
        { status: 400 }
      );
    }

    // 6. Get user's subscription plan, role, and notification settings
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        subscriptions: true,
        notificationSettings: true,
      },
    });

    const plan = user?.subscriptions?.plan;
    const subscriptionPlan = (plan ? plan.toLowerCase() : 'free') as 'free' | 'pro' | 'team';
    const userRole = (session.user as any).role as 'USER' | 'ADMIN' | 'SUPER_ADMIN' | undefined;

    // Extract user's minimum match score preference (default: 60)
    const notificationSettings = user?.notificationSettings as NotificationSettings | null;
    const minimumMatchScore = notificationSettings?.minimumMatchScore ?? 60;
    const maxMatches = MAX_MATCHES_BY_PLAN[subscriptionPlan] || 3;

    // 7. Check rate limit (critical for business model!)
    // Note: Admins bypass rate limits for testing/support purposes
    const rateLimitCheck = await checkMatchLimit(userId, subscriptionPlan, userRole);

    if (!rateLimitCheck.allowed) {
      return NextResponse.json(
        {
          error: 'Monthly match limit reached',
          limit: 2,
          remaining: 0,
          resetDate: rateLimitCheck.resetDate.toISOString(),
          message: '이번 달 무료 매칭 횟수를 모두 사용하셨습니다. Pro 플랜으로 업그레이드하여 무제한 매칭을 받으세요.',
          upgradeUrl: '/pricing',
        },
        { status: 429 }
      );
    }

    if (matchingAlgorithm === 'v7-llm') {
      console.log('[V7-LLM MATCHING] 실시간 매칭 시작:', organizationId);
      const { runV7MatchingForOrganization } = await import('@/lib/matching/v7-llm/orchestrator');
      await runV7MatchingForOrganization(organizationId);

      const v7Matches = await db.funding_matches.findMany({
        where: {
          organizationId,
          llmDecision: { in: ['MATCH', 'PARTIAL'] },
          llmScore: { gte: minimumMatchScore },
          deletedAt: null,
          funding_programs: {
            status: 'ACTIVE',
          },
        },
        include: { funding_programs: true },
        orderBy: { llmScore: 'desc' },
        take: maxMatches,
      });

      if (v7Matches.length === 0) {
        await trackApiUsage(userId, '/api/matches/generate');

        return NextResponse.json(
          {
            success: true,
            matches: [],
            usage: {
              plan: subscriptionPlan,
              matchesUsed: 2 - rateLimitCheck.remaining + 1,
              matchesRemaining: rateLimitCheck.remaining - 1,
              resetDate: rateLimitCheck.resetDate.toISOString(),
            },
            message: '귀하의 프로필과 일치하는 프로그램이 없습니다. 프로필을 업데이트하거나 나중에 다시 시도해주세요.',
            isHistorical: false,
            algorithmVersion: 'v7-llm',
          },
          { status: 200 }
        );
      }

      const response = {
        success: true,
        matches: v7Matches.map((match) => ({
          id: match.id,
          program: {
            id: match.funding_programs.id,
            title: match.funding_programs.title,
            description: match.funding_programs.description,
            agencyId: match.funding_programs.agencyId,
            category: match.funding_programs.category,
            budgetAmount: match.funding_programs.budgetAmount?.toString(),
            deadline: match.funding_programs.deadline?.toISOString(),
            announcementUrl: match.funding_programs.announcementUrl,
          },
          score: match.llmScore ?? 0,
          personalizedScore: null,
          explanation: {
            summary: match.llmSummary,
            decision: match.llmDecision,
            confidence: match.llmConfidence,
            reasons: match.llmReasons,
            eligibility: match.llmEligibility,
          },
          createdAt: match.createdAt.toISOString(),
        })),
        usage: {
          plan: subscriptionPlan,
          matchesUsed: 2 - rateLimitCheck.remaining + 1,
          matchesRemaining: rateLimitCheck.remaining - 1,
          resetDate: rateLimitCheck.resetDate.toISOString(),
        },
        message: `${v7Matches.length}개의 적합한 지원 프로그램을 찾았습니다.`,
        isHistorical: false,
        algorithmVersion: 'v7-llm',
      };

      await setCache(matchCacheKey, response, CACHE_TTL.MATCH_RESULTS);
      await trackApiUsage(userId, '/api/matches/generate');

      const hasGeneratedBefore = await hasFunnelEvent(userId, AuditAction.FIRST_MATCH_GENERATED);
      if (!hasGeneratedBefore && v7Matches.length > 0) {
        await logFunnelEvent(
          userId,
          AuditAction.FIRST_MATCH_GENERATED,
          v7Matches[0].id,
          `Generated ${v7Matches.length} matches, top score: ${v7Matches[0].llmScore ?? 0}`
        );
      }

      return NextResponse.json(response, { status: 200 });
    }

    // 8. Fetch active funding programs (with cache)
    const programsCacheKey = getProgramsCacheKey();
    let programs = await getCache<any[]>(programsCacheKey);

    if (!programs) {
      // Cache miss - fetch from database
      programs = await db.funding_programs.findMany({
        where: {
          status: ProgramStatus.ACTIVE,
          announcementType: AnnouncementType.R_D_PROJECT, // Only R&D funding opportunities (exclude surveys, events, notices)
          // Deadline filter: Exclude programs with past deadlines but keep NULL (TBD) deadlines
          // - Many Jan-March NTIS announcements don't have deadlines yet → stored as NULL → valid
          // - Programs with explicit past deadlines are expired → exclude
          OR: [
            { deadline: null },              // TBD deadlines are valid
            { deadline: { gte: new Date() } }, // Future deadlines are valid
          ],

          // Development mode: Allow seed data (scrapingSource = null) for local testing
          // Production mode: Exclude seed data to prevent showing test programs to users
          ...(process.env.NODE_ENV === 'production' && {
            scrapingSource: {
              not: null, // Exclude test seed data (seed data has scrapingSource = null)
              notIn: ['NTIS_API'], // Exclude NTIS_API (old project data, not announcements)
            },
          }),
        },
        orderBy: [
          { publishedAt: 'desc' }, // Newest announcements first
          { deadline: 'asc' },     // Then by urgency (soonest deadline) - NULLs appear last
        ],
      });

      if (programs.length > 0) {
        // Cache active programs for 6 hours
        await setCache(programsCacheKey, programs, CACHE_TTL.PROGRAMS);
      }
    }

    // Historical fallback: If no active programs, show recent opportunities (Jan 1 - today)
    let isHistoricalFallback = false;
    if (programs.length === 0) {
      const yearStart = new Date(new Date().getFullYear(), 0, 1); // Jan 1 of current year
      const today = new Date();

      programs = await db.funding_programs.findMany({
        where: {
          status: ProgramStatus.ACTIVE,
          announcementType: AnnouncementType.R_D_PROJECT, // Only R&D funding opportunities (exclude surveys, events, notices)
          deadline: {
            gte: yearStart,
            lt: today, // Only past deadlines (historical)
          },
          // Allow NULL budgets in historical fallback too
          scrapingSource: {
            not: null,
            notIn: ['NTIS_API'],
          },
        },
        orderBy: [
          { publishedAt: 'desc' },
          { deadline: 'desc' }, // Most recent deadlines first for historical data
        ],
        take: 10, // Limit historical results
      });

      if (programs.length > 0) {
        isHistoricalFallback = true;
      } else {
        // No programs at all (active or historical)
        return NextResponse.json(
          {
            error: 'No funding programs available',
            message: '현재 활성화된 지원 프로그램이 없습니다. 나중에 다시 시도해주세요.',
          },
          { status: 404 }
        );
      }
    }

    // 9. Generate matches using algorithm
    // Plan-based limit: Free(3), Pro(10), Team(15)
    // Score filter: User's minimumMatchScore from notification settings
    console.log('[MATCH GENERATION] Using organization profile for org:', organizationId);
    console.log('[MATCH GENERATION] Profile data:', {
      name: organization.name,
      industrySector: organization.industrySector,
      trlLevel: organization.technologyReadinessLevel,
      rdExperience: organization.rdExperience,
      employeeCount: organization.employeeCount,
      profileUpdatedAt: organization.updatedAt,
    });
    console.log('[MATCH GENERATION] Settings:', {
      plan: subscriptionPlan,
      maxMatches,
      minimumMatchScore,
    });
    const matchResults: Array<MatchScore | V6MatchScore> = matchingAlgorithm === 'v6.0-funnel'
      ? generateMatchesV6(organization, programs, maxMatches, { minimumScore: minimumMatchScore })
      : generateMatches(organization, programs, maxMatches, { minimumScore: minimumMatchScore });
    console.log('[MATCH GENERATION] Generated', matchResults.length, 'matches');

    if (matchResults.length === 0) {
      return NextResponse.json(
        {
          success: true,
          matches: [],
          usage: {
            plan: subscriptionPlan,
            matchesUsed: 2 - rateLimitCheck.remaining + 1, // +1 for current request
            matchesRemaining: rateLimitCheck.remaining - 1,
            resetDate: rateLimitCheck.resetDate.toISOString(),
          },
          message: '귀하의 프로필과 일치하는 프로그램이 없습니다. 프로필을 업데이트하거나 나중에 다시 시도해주세요.',
        },
        { status: 200 }
      );
    }

    // 10. Validate program IDs exist (cache might have stale data)
    // This prevents FK constraint violation if programs were deleted while cached
    const programIdsFromMatches = matchResults.map((m) => m.program.id);
    const existingPrograms = await db.funding_programs.findMany({
      where: {
        id: { in: programIdsFromMatches },
      },
      select: { id: true },
    });
    const existingProgramIds = new Set(existingPrograms.map((p) => p.id));

    // Filter out matches with stale/deleted program IDs
    const validMatchResults = matchResults.filter((m) =>
      existingProgramIds.has(m.program.id)
    );

    // If stale programs were found, invalidate the programs cache
    if (validMatchResults.length < matchResults.length) {
      console.warn(
        `[MATCH GENERATION] Filtered out ${matchResults.length - validMatchResults.length} stale program(s). Invalidating cache.`
      );
      // Invalidate cache so next request fetches fresh data
      const { invalidateProgramsCache } = await import('@/lib/cache/redis-cache');
      await invalidateProgramsCache();
    }

    if (validMatchResults.length === 0) {
      return NextResponse.json(
        {
          success: true,
          matches: [],
          usage: {
            plan: subscriptionPlan,
            matchesUsed: 2 - rateLimitCheck.remaining + 1,
            matchesRemaining: rateLimitCheck.remaining - 1,
            resetDate: rateLimitCheck.resetDate.toISOString(),
          },
          message: '유효한 프로그램을 찾을 수 없습니다. 다시 시도해주세요.',
        },
        { status: 200 }
      );
    }

    // 10.5. Personalization Layer (re-ranks matches based on user behavior)
    // Wrapped in try/catch: failure falls back to base scores (graceful degradation)
    let personalizedScoreMap = new Map<string, number>();
    try {
      const personalizationConfig = await loadActivePersonalizationConfig();

      if (personalizationConfig.isActive && personalizationConfig.config) {
        console.log('[PERSONALIZATION] Active config:', personalizationConfig.configName);

        // Transform to MatchWithScore[] for personalization layer
        const baseMatches: MatchWithScore[] = validMatchResults.map(m => ({
          program: m.program,
          baseScore: m.score,
        }));

        const personalizedResult = await generatePersonalizedMatches(
          organizationId,
          baseMatches,
          personalizationConfig.config
        );

        // Build programId → personalizedScore map
        for (const pm of personalizedResult.matches) {
          personalizedScoreMap.set(
            pm.program.id,
            Math.round(pm.personalizedScore)
          );
        }

        console.log('[PERSONALIZATION] Generated personalized scores:', {
          coldStartStatus: personalizedResult.coldStartStatus,
          explorationCount: personalizedResult.explorationCount,
          matchCount: personalizedResult.matches.length,
        });
      } else {
        console.log('[PERSONALIZATION] Inactive — using base scores only');
      }
    } catch (personalizationError) {
      // Graceful degradation: continue with base scores
      console.error('[PERSONALIZATION] Error (fallback to base scores):', personalizationError);
      personalizedScoreMap = new Map(); // Clear any partial results
    }

    // 10.6. Shadow Mode: Run proximity algorithm in parallel for A/B comparison
    // This is non-blocking — failure does not affect user-facing results
    if (isShadowModeEnabled()) {
      try {
        console.log('[SHADOW MODE] Running v5.0 proximity algorithm in parallel');

        const shadowResults: Array<{
          programId: string;
          programTitle: string;
          currentScore: number;
          proximityScore: number;
          scoreDelta: number;
        }> = [];

        for (const matchResult of validMatchResults) {
          const idealProfile = matchResult.program.idealApplicantProfile as unknown as IdealApplicantProfile | null;

          if (idealProfile) {
            const proxScore = calculateProximityScore(
              organization,
              idealProfile,
              matchResult.program.deadline
            );

            shadowResults.push({
              programId: matchResult.program.id,
              programTitle: matchResult.program.title,
              currentScore: matchResult.score,
              proximityScore: proxScore.totalScore,
              scoreDelta: proxScore.totalScore - matchResult.score,
            });
          }
        }

        if (shadowResults.length > 0) {
          console.log(`[SHADOW MODE] Compared ${shadowResults.length} programs:`);
          console.log(`[SHADOW MODE] Avg score delta: ${(shadowResults.reduce((s, r) => s + r.scoreDelta, 0) / shadowResults.length).toFixed(1)}`);
          console.log(`[SHADOW MODE] Score deltas:`, shadowResults.map(r => ({
            title: r.programTitle.slice(0, 40),
            v44: r.currentScore,
            v50: r.proximityScore,
            delta: r.scoreDelta,
          })));

          // Log rank correlation
          const currentRanked = [...shadowResults].sort((a, b) => b.currentScore - a.currentScore);
          const proximityRanked = [...shadowResults].sort((a, b) => b.proximityScore - a.proximityScore);

          // Check top-3 overlap
          const currentTop3 = new Set(currentRanked.slice(0, 3).map(r => r.programId));
          const proximityTop3 = new Set(proximityRanked.slice(0, 3).map(r => r.programId));
          const top3Overlap = Array.from(currentTop3).filter(id => proximityTop3.has(id)).length;

          console.log(`[SHADOW MODE] Top-3 overlap: ${top3Overlap}/3`);
        } else {
          console.log('[SHADOW MODE] No programs with ideal profiles — generate profiles first');
        }
      } catch (shadowError) {
        console.error('[SHADOW MODE] Error (non-blocking):', shadowError);
      }
    }

    // 11. Store matches in database (UPSERT to handle existing matches)
    const createdMatches = await Promise.all(
      validMatchResults.map(async (matchResult) => {
        // Generate Korean explanations
        const explanation = matchingAlgorithm === 'v6.0-funnel'
          ? generateV6Explanation(matchResult as V6MatchScore, organization, matchResult.program)
          : generateExplanation(matchResult as MatchScore, organization, matchResult.program);

        // Merge algorithm's numeric breakdown into explanation JSON
        // This allows the AI explanation API to read actual scores instead of zeros
        const explanationWithBreakdown = {
          ...explanation,
          scoreBreakdown: {
            keywordScore: matchResult.breakdown.keywordScore,
            industryScore: matchResult.breakdown.industryScore,
            trlScore: matchResult.breakdown.trlScore,
            typeScore: matchResult.breakdown.typeScore,
            rdScore: matchResult.breakdown.rdScore,
            deadlineScore: matchResult.breakdown.deadlineScore,
          },
        };

        // UPSERT match record (create or update existing)
        // This makes the API idempotent - clicking "Create Match" multiple times is safe
        // Resolve personalized score (null if personalization inactive)
        const pScore = personalizedScoreMap.get(matchResult.program.id) ?? null;
        const pAt = pScore !== null ? new Date() : null;

        return db.funding_matches.upsert({
          where: {
            organizationId_programId: {
              organizationId: organization.id,
              programId: matchResult.program.id,
            },
          },
          update: {
            // Update score and explanation if match already exists
            // Preserves user state: viewed, saved, notificationSent flags
            score: matchResult.score,
            explanation: explanationWithBreakdown as any,
            personalizedScore: pScore,
            personalizedAt: pAt,
          },
          create: {
            // Create new match if doesn't exist
            organizationId: organization.id,
            programId: matchResult.program.id,
            score: matchResult.score,
            explanation: explanationWithBreakdown as any,
            personalizedScore: pScore,
            personalizedAt: pAt,
          },
          include: {
            funding_programs: true,
          },
        });
      })
    );

    // 12. Log match quality for analytics (non-blocking)
    await logMatchQualityBulk(
      validMatchResults.map((matchResult, index) => ({
        matchId: createdMatches[index].id,
        organizationId: organization.id,
        programId: matchResult.program.id,
        category: matchResult.program.category || 'UNKNOWN',
        score: matchResult.score,
        breakdown: matchResult.breakdown,
        saved: false, // Will be updated when user saves
        viewed: false, // Will be updated when user views
      }))
    );

    // 13. Track API usage for analytics
    await trackApiUsage(userId, '/api/matches/generate');

    // 14. Return matches with explanations
    const response = {
      success: true,
      matches: createdMatches.map((match: any) => ({
        id: match.id,
        program: {
          id: match.funding_programs.id,
          title: match.funding_programs.title,
          description: match.funding_programs.description,
          agencyId: match.funding_programs.agencyId,
          category: match.funding_programs.category,
          budgetAmount: match.funding_programs.budgetAmount?.toString(),
          deadline: match.funding_programs.deadline?.toISOString(),
          announcementUrl: match.funding_programs.announcementUrl,
        },
        score: match.score,
        personalizedScore: match.personalizedScore ?? null,
        explanation: match.explanation as any, // Already a JSON object
        createdAt: match.createdAt.toISOString(),
      })),
      usage: {
        plan: subscriptionPlan,
        matchesUsed: 2 - rateLimitCheck.remaining + 1, // +1 for current request
        matchesRemaining: rateLimitCheck.remaining - 1,
        resetDate: rateLimitCheck.resetDate.toISOString(),
      },
      message: isHistoricalFallback
        ? `현재 진행 중인 공고는 없지만, 올해 마감된 유사 프로그램 ${validMatchResults.length}개를 찾았습니다. 새로운 공고가 올라오면 알림을 받으세요.`
        : `${validMatchResults.length}개의 적합한 지원 프로그램을 찾았습니다.`,
      isHistorical: isHistoricalFallback,
      algorithmVersion: MATCH_ALGORITHM_VERSION,
    };

    // 13. Cache match results for 24 hours
    await setCache(matchCacheKey, response, CACHE_TTL.MATCH_RESULTS);

    // 14. Log funnel event: FIRST_MATCH_GENERATED (only first time)
    const hasGeneratedBefore = await hasFunnelEvent(userId, AuditAction.FIRST_MATCH_GENERATED);
    if (!hasGeneratedBefore && createdMatches.length > 0) {
      await logFunnelEvent(
        userId,
        AuditAction.FIRST_MATCH_GENERATED,
        createdMatches[0].id,
        `Generated ${createdMatches.length} matches, top score: ${createdMatches[0].score}`
      );
    }

    return NextResponse.json(response, { status: 200 });

  } catch (error) {
    console.error('Match generation error:', error);

    // Log error details for debugging
    if (error instanceof Error) {
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
      });
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: '매칭 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      },
      { status: 500 }
    );
  }
  // NOTE: Do NOT call db.$disconnect() in Next.js API routes
  // It breaks connection pooling and causes subsequent requests to fail
}
