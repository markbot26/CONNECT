import type { funding_programs, organizations } from '@prisma/client';
import { db } from '@/lib/db';
import { matchProgramToOrganization } from './llm-matcher';
import type { V2MatchingOptions } from './types';

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRIES = 1;
const LLM_MODEL = 'claude-3-5-haiku-20241022';

function normalizeOptions(options: V2MatchingOptions = {}): Required<V2MatchingOptions> {
  return {
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retries: options.retries ?? DEFAULT_RETRIES,
  };
}

export function shouldSkipMatching(program: funding_programs, org: organizations): boolean {
  if (program.targetType?.length > 0 && !program.targetType.includes(org.type)) {
    return true;
  }
  return false;
}

async function pLimit<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency).map((task) => task());
    const batchResults = await Promise.allSettled(batch);
    results.push(...batchResults);
  }

  return results;
}

async function upsertV2Match(
  organizationId: string,
  programId: string,
  matchResult: {
    score: number;
    decision: string;
    confidence: string;
    summary: string;
    reasons: Record<string, unknown>;
    eligibility: Record<string, unknown>;
  }
): Promise<void> {
  const now = new Date();

  await db.funding_matches.upsert({
    where: {
      organizationId_programId: {
        organizationId,
        programId,
      },
    },
    update: {
      llmScore: matchResult.score,
      llmDecision: matchResult.decision,
      llmConfidence: matchResult.confidence,
      llmSummary: matchResult.summary,
      llmReasons: matchResult.reasons as any,
      llmEligibility: matchResult.eligibility as any,
      llmModel: LLM_MODEL,
      llmMatchedAt: now,
    },
    create: {
      organizationId,
      programId,
      score: 0,
      explanation: {},
      llmScore: matchResult.score,
      llmDecision: matchResult.decision,
      llmConfidence: matchResult.confidence,
      llmSummary: matchResult.summary,
      llmReasons: matchResult.reasons as any,
      llmEligibility: matchResult.eligibility as any,
      llmModel: LLM_MODEL,
      llmMatchedAt: now,
    },
  });
}

export async function runV2MatchingForProgram(
  programId: string,
  options: V2MatchingOptions = {}
): Promise<void> {
  const config = normalizeOptions(options);

  try {
    const program = await db.funding_programs.findUnique({
      where: { id: programId },
    });

    if (!program) {
      console.log('[V2 MATCHING] 프로그램을 찾을 수 없습니다:', programId);
      return;
    }

    const organizations = await db.organizations.findMany({
      where: { status: 'ACTIVE' },
    });

    const tasks = organizations
      .filter((org) => !shouldSkipMatching(program, org))
      .map((org) => async () => {
        try {
          const matchResult = await matchProgramToOrganization(program, org, config);
          await upsertV2Match(org.id, program.id, matchResult);
        } catch (error) {
          console.error('[V2 MATCHING] 프로그램 매칭 실패:', {
            programId: program.id,
            organizationId: org.id,
            error,
          });
          throw error;
        }
      });

    const results = await pLimit(tasks, config.concurrency);
    const failures = results.filter((result) => result.status === 'rejected').length;

    console.log('[V2 MATCHING] 프로그램 매칭 완료:', {
      programId,
      total: results.length,
      failures,
    });
  } catch (error) {
    console.error('[V2 MATCHING] 프로그램 매칭 오케스트레이션 실패:', {
      programId,
      error,
    });
  }
}

export async function runV2MatchingForOrganization(
  organizationId: string,
  options: V2MatchingOptions = {}
): Promise<void> {
  const config = normalizeOptions(options);

  try {
    const organization = await db.organizations.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      console.log('[V2 MATCHING] 기관을 찾을 수 없습니다:', organizationId);
      return;
    }

    const programs = await db.funding_programs.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { deadline: null },
          { deadline: { gte: new Date() } },
        ],
      },
    });

    const tasks = programs
      .filter((program) => !shouldSkipMatching(program, organization))
      .map((program) => async () => {
        try {
          const matchResult = await matchProgramToOrganization(program, organization, config);
          await upsertV2Match(organization.id, program.id, matchResult);
        } catch (error) {
          console.error('[V2 MATCHING] 기관 매칭 실패:', {
            programId: program.id,
            organizationId: organization.id,
            error,
          });
          throw error;
        }
      });

    const results = await pLimit(tasks, config.concurrency);
    const failures = results.filter((result) => result.status === 'rejected').length;

    console.log('[V2 MATCHING] 기관 매칭 완료:', {
      organizationId,
      total: results.length,
      failures,
    });
  } catch (error) {
    console.error('[V2 MATCHING] 기관 매칭 오케스트레이션 실패:', {
      organizationId,
      error,
    });
  }
}
