export type QualitySeverity = 'clean' | 'minor' | 'critical';

export interface QualityIssue {
  issue_id: string;
  category:
    | 'missing_values'
    | 'empty_column'
    | 'empty_section'
    | 'empty_page'
    | 'truncated_text'
    | 'no_extractable_text';
  severity: 'minor' | 'critical';
  location: string;
  description: string;
  affected_ratio?: number;
}

export interface SuggestedCorrection {
  correction_id: string;
  issue_id: string;
  doc_id: string;
  filename: string;
  category: QualityIssue['category'];
  location: string;
  gap_description: string;
  suggested_fill: string;
  source_type: 'cross_document' | 'column_pattern' | 'none';
  source_document?: string;
  source_chunk_id?: string;
  source_excerpt?: string;
  confidence_score: number; // 0.0 to 1.0
  confidence_level: 'High' | 'Moderate' | 'Low';
  rationale: string;
  status: 'pending' | 'accepted' | 'rejected';
  has_corpus_evidence: boolean;
  accepted_at?: string;
}

export interface DocumentQualityReport {
  doc_id: string;
  filename: string;
  file_type: string;
  status: QualitySeverity;
  total_issues: number;
  critical_issues: number;
  minor_issues: number;
  issues: QualityIssue[];
  summary: string;
  checked_at: string;
  suggested_corrections?: SuggestedCorrection[];
}

export interface DocumentChunk {
  chunk_id: string;
  doc_id: string;
  filename: string;
  file_type: string;
  text: string;
  chunk_index: number;
  total_chunks: number;
  char_count: number;
  extraction_note?: string;
  quality_status?: QualitySeverity;
  quality_summary?: string;
  quality_issues?: QualityIssue[];
  quality_alert?: string;
  is_supplemented?: boolean;
  supplement_source?: string;
  user_approved?: boolean;
  confidence?: number;
}

export interface IndexedDocument {
  doc_id: string;
  filename: string;
  file_type: string;
  chunk_count: number;
  total_chars: number;
  indexed_at: string;
  extraction_note?: string;
  quality_report?: DocumentQualityReport;
  accepted_corrections?: SuggestedCorrection[];
  has_supplemental_draft?: boolean;
}

export interface ClaimAudit {
  claim_id: number;
  text: string;
  status: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNVERIFIED';
  matched_chunk_id?: string;
  support_confidence: number;
  note: string;
}

export interface EvaluationData {
  groundedness_score: number;
  relevance_score: number;
  is_grounded: boolean;
  is_relevant: boolean;
  overall_passed: boolean;
  claims_analysis: ClaimAudit[];
  explanation: string;
  missing_evidence?: string;
}

export interface RetrievedChunkRecord {
  rank: number;
  filename: string;
  chunk_id: string;
  chunk_index: number;
  total_chunks: number;
  similarity_score: number;
  text: string;
  file_type: string;
  quality_status?: QualitySeverity;
  quality_summary?: string;
  quality_issues?: QualityIssue[];
  quality_alert?: string;
  is_supplemented?: boolean;
  supplement_source?: string;
  user_approved?: boolean;
  confidence?: number;
}

export interface AttemptLog {
  cycle_number: number;
  query_used: string;
  k_used: number;
  strategy_description: string;
  chunks: RetrievedChunkRecord[];
  draft_answer: string;
  evaluation: EvaluationData;
  delta_explanation?: string;
}

export interface PipelineResult {
  question: string;
  final_answer: string;
  cycles_used: number;
  passed: boolean;
  honesty_gate_triggered: boolean;
  groundedness_score: number;
  relevance_score: number;
  evaluation_explanation: string;
  claims_analysis: ClaimAudit[];
  cited_chunks: RetrievedChunkRecord[];
  attempts: AttemptLog[];
  has_supplemented_chunks?: boolean;
  supplemented_sources?: string[];
}

export type PipelineStage =
  | 'IDLE'
  | 'RETRIEVING'
  | 'GENERATING'
  | 'EVALUATING'
  | 'CHECKING_GATE'
  | 'RETRYING'
  | 'COMPLETED'
  | 'HONESTY_GATE_ACTIVATED';

export interface StageStatusUpdate {
  stage: PipelineStage;
  cycle: number;
  max_retries: number;
  message: string;
  k?: number;
  query?: string;
  groundedness?: number;
  relevance?: number;
  passed?: boolean;
}

export interface DocumentSummary {
  doc_id: string;
  filename: string;
  file_type: string;
  summary: string;
  key_entities: string[];
  chunk_count: number;
}

export interface CorpusSummaryReport {
  doc_summaries: DocumentSummary[];
  corpus_summary: string;
  suggested_questions: string[];
  generated_at: string;
}

export type HistoryItemType = 'upload' | 'query' | 'summary';

export interface StorageStats {
  db_path: string;
  db_size_bytes: number;
  db_size_formatted: string;
  doc_count: number;
  chunk_count: number;
  event_count: number;
  session_count: number;
}

export interface SessionRecord {
  session_id: string;
  name: string;
  created_at: string;
  last_active_at: string;
  event_count?: number;
}

export interface UnifiedHistoryItem {
  id: string;
  session_id?: string;
  type: HistoryItemType;
  timestamp: string;
  status: 'success' | 'amber';
  // Upload event fields
  batch_name?: string;
  file_count?: number;
  chunk_count?: number;
  summary?: string;
  failures?: string[];
  quality_rollup?: string;
  quality_issues_count?: number;
  // Query event fields
  question?: string;
  answer?: string;
  cycles_used?: number;
  groundedness?: number;
  relevance?: number;
  sources?: string[];
  honesty_gate_triggered?: boolean;
  result?: PipelineResult;
  // Summary event fields
  corpus_summary_report?: CorpusSummaryReport;
}
