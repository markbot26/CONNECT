export interface LLMMatchResult {
  score: number;
  decision: 'MATCH' | 'PARTIAL' | 'NO_MATCH';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  summary: string;
  reasons: {
    strengths: string[];
    weaknesses: string[];
    domain_fit: string;
    tech_fit: string;
  };
  eligibility: {
    eligible: boolean;
    issues: string[];
  };
}

export interface V2MatchingOptions {
  concurrency?: number;      // 기본 5
  timeoutMs?: number;        // 기본 30000
  retries?: number;          // 기본 1
}
