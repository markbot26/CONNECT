import Anthropic from '@anthropic-ai/sdk';
import type { funding_programs, organizations } from '@prisma/client';
import type { LLMMatchResult, V2MatchingOptions } from './types';

const LLM_MODEL = 'claude-3-5-haiku-20241022';

const SYSTEM_PROMPT = `당신은 대한민국 정부 R&D 연구과제 공고와 기관의 적합성을 평가하는 전문가입니다.

기관 프로필과 연구과제 공고를 비교하여:
1. 이 기관이 이 연구과제에 실제로 참여할 역량과 경험이 있는지 판단하세요
2. 기술 키워드가 겹치더라도 도메인(적용 분야)이 다르면 부적합입니다
3. 기관의 기술 분야와 공고의 연구 분야가 실질적으로 연결되는지 평가하세요

반드시 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.`;

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '미입력';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : '미입력';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '미입력';
    }
  }

  const text = String(value).trim();
  return text.length > 0 ? text : '미입력';
}

export function buildOrganizationPrompt(org: organizations): string {
  return `<organization_profile>
<id>${formatValue(org.id)}</id>
<name>${formatValue(org.name)}</name>
<type>${formatValue(org.type)}</type>
<businessStructure>${formatValue(org.businessStructure)}</businessStructure>
<description>${formatValue(org.description)}</description>
<industrySector>${formatValue(org.industrySector)}</industrySector>
<primaryBusinessDomain>${formatValue(org.primaryBusinessDomain)}</primaryBusinessDomain>
<companyProfileDescription>${formatValue(org.companyProfileDescription)}</companyProfileDescription>
<employeeCount>${formatValue(org.employeeCount)}</employeeCount>
<revenueRange>${formatValue(org.revenueRange)}</revenueRange>
<rdExperience>${formatValue(org.rdExperience)}</rdExperience>
<technologyReadinessLevel>${formatValue(org.technologyReadinessLevel)}</technologyReadinessLevel>
<targetResearchTRL>${formatValue(org.targetResearchTRL)}</targetResearchTRL>
<targetResearchTRLMin>${formatValue(org.targetResearchTRLMin)}</targetResearchTRLMin>
<targetResearchTRLMax>${formatValue(org.targetResearchTRLMax)}</targetResearchTRLMax>
<researchFocusAreas>${formatValue(org.researchFocusAreas)}</researchFocusAreas>
<keyTechnologies>${formatValue(org.keyTechnologies)}</keyTechnologies>
<technologyDomainsSpecific>${formatValue(org.technologyDomainsSpecific)}</technologyDomainsSpecific>
<instituteType>${formatValue(org.instituteType)}</instituteType>
<hasResearchInstitute>${formatValue(org.hasResearchInstitute)}</hasResearchInstitute>
<certifications>${formatValue(org.certifications)}</certifications>
<governmentCertifications>${formatValue(org.governmentCertifications)}</governmentCertifications>
<annualRdBudget>${formatValue(org.annualRdBudget)}</annualRdBudget>
<researcherCount>${formatValue(org.researcherCount)}</researcherCount>
<priorGrantWins>${formatValue(org.priorGrantWins)}</priorGrantWins>
<priorGrantTotalAmount>${formatValue(org.priorGrantTotalAmount)}</priorGrantTotalAmount>
<excludedDomains>${formatValue(org.excludedDomains)}</excludedDomains>
</organization_profile>`;
}

export function buildProgramPrompt(program: funding_programs): string {
  return `<research_program>
<id>${formatValue(program.id)}</id>
<title>${formatValue(program.title)}</title>
<description>${formatValue(program.description)}</description>
<agencyId>${formatValue(program.agencyId)}</agencyId>
<announcingAgency>${formatValue(program.announcingAgency)}</announcingAgency>
<ministry>${formatValue(program.ministry)}</ministry>
<category>${formatValue(program.category)}</category>
<announcementType>${formatValue(program.announcementType)}</announcementType>
<targetType>${formatValue(program.targetType)}</targetType>
<minTrl>${formatValue(program.minTrl)}</minTrl>
<maxTrl>${formatValue(program.maxTrl)}</maxTrl>
<budgetAmount>${formatValue(program.budgetAmount)}</budgetAmount>
<fundingPeriod>${formatValue(program.fundingPeriod)}</fundingPeriod>
<deadline>${formatValue(program.deadline)}</deadline>
<keywords>${formatValue(program.keywords)}</keywords>
<primaryTargetIndustry>${formatValue(program.primaryTargetIndustry)}</primaryTargetIndustry>
<eligibilityCriteria>${formatValue(program.eligibilityCriteria ? JSON.stringify(program.eligibilityCriteria) : null)}</eligibilityCriteria>
<requiredCertifications>${formatValue(program.requiredCertifications)}</requiredCertifications>
<preferredCertifications>${formatValue(program.preferredCertifications)}</preferredCertifications>
<requiredMinEmployees>${formatValue(program.requiredMinEmployees)}</requiredMinEmployees>
<requiredMaxEmployees>${formatValue(program.requiredMaxEmployees)}</requiredMaxEmployees>
<requiredMinRevenue>${formatValue(program.requiredMinRevenue)}</requiredMinRevenue>
<requiredMaxRevenue>${formatValue(program.requiredMaxRevenue)}</requiredMaxRevenue>
<requiredInvestmentAmount>${formatValue(program.requiredInvestmentAmount)}</requiredInvestmentAmount>
<requiredOperatingYears>${formatValue(program.requiredOperatingYears)}</requiredOperatingYears>
<maxOperatingYears>${formatValue(program.maxOperatingYears)}</maxOperatingYears>
<requiresResearchInstitute>${formatValue(program.requiresResearchInstitute)}</requiresResearchInstitute>
</research_program>`;
}

function parseLLMResult(rawText: string): LLMMatchResult {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('LLM 응답에서 JSON을 찾을 수 없습니다.');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    score: Math.max(0, Math.min(100, Number(parsed.score ?? 0))),
    decision: parsed.decision as LLMMatchResult['decision'],
    confidence: parsed.confidence as LLMMatchResult['confidence'],
    summary: String(parsed.summary ?? ''),
    reasons: {
      strengths: Array.isArray(parsed.reasons?.strengths) ? parsed.reasons.strengths.map(String) : [],
      weaknesses: Array.isArray(parsed.reasons?.weaknesses) ? parsed.reasons.weaknesses.map(String) : [],
      domain_fit: String(parsed.reasons?.domain_fit ?? ''),
      tech_fit: String(parsed.reasons?.tech_fit ?? ''),
    },
    eligibility: {
      eligible: Boolean(parsed.eligibility?.eligible),
      issues: Array.isArray(parsed.eligibility?.issues) ? parsed.eligibility.issues.map(String) : [],
    },
  };
}

export async function matchProgramToOrganization(
  program: funding_programs,
  organization: organizations,
  options: V2MatchingOptions = {}
): Promise<LLMMatchResult> {
  const client = new Anthropic();
  const timeoutMs = options.timeoutMs ?? 30000;
  const retries = options.retries ?? 1;

  const organizationPrompt = buildOrganizationPrompt(organization);
  const programPrompt = buildProgramPrompt(program);
  const userPrompt = `${organizationPrompt}\n\n${programPrompt}`;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await client.messages.create({
        model: LLM_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        signal: controller.signal,
      });

      const content = response.content[0];
      if (!content || content.type !== 'text') {
        throw new Error('LLM 응답 타입이 예상과 다릅니다.');
      }

      return parseLLMResult(content.text);
    } catch (error) {
      console.error('[V2 MATCHING] LLM 매칭 실패:', {
        attempt: attempt + 1,
        programId: program.id,
        organizationId: organization.id,
        error,
      });

      if (attempt >= retries) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('LLM 매칭 재시도 후에도 실패했습니다.');
}
