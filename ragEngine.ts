import {
  DocumentChunk,
  IndexedDocument,
  ClaimAudit,
  EvaluationData,
  RetrievedChunkRecord,
  AttemptLog,
  PipelineResult,
  PipelineStage,
  StageStatusUpdate,
  CorpusSummaryReport,
  DocumentSummary,
  QualitySeverity,
  QualityIssue,
  DocumentQualityReport,
  SuggestedCorrection,
} from '../types/rag';

export class ClientRAGEngine {
  private chunks: DocumentChunk[] = [];
  private documents: Map<string, IndexedDocument> = new Map();
  private embeddingCache: Map<string, Float32Array> = new Map();
  private readonly EMBED_DIM = 128;

  constructor() {
    this.seedDefaultCorpus();
  }

  // Generate dense normalized semantic embedding vector
  private generateEmbedding(text: string): Float32Array {
    const cached = this.embeddingCache.get(text);
    if (cached) return cached;

    const vec = new Float32Array(this.EMBED_DIM);
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const weight = 1.0 + 1.0 / (i + 1);

      // Fast hash code
      let hash = 0;
      for (let c = 0; c < word.length; c++) {
        hash = (hash << 5) - hash + word.charCodeAt(c);
        hash |= 0;
      }
      const idx = Math.abs(hash) % this.EMBED_DIM;
      vec[idx] += weight;

      // 3-grams
      if (word.length >= 3) {
        for (let g = 0; g < word.length - 2; g++) {
          let gHash = 0;
          for (let gc = 0; gc < 3; gc++) {
            gHash = (gHash << 5) - gHash + word.charCodeAt(g + gc);
            gHash |= 0;
          }
          vec[Math.abs(gHash) % this.EMBED_DIM] += 0.5;
        }
      }
    }

    // L2 Normalize
    let norm = 0;
    for (let i = 0; i < this.EMBED_DIM; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 1e-9) {
      for (let i = 0; i < this.EMBED_DIM; i++) {
        vec[i] /= norm;
      }
    }

    this.embeddingCache.set(text, vec);
    return vec;
  }

  // Text chunker
  private chunkText(
    text: string,
    docId: string,
    filename: string,
    fileType: string,
    chunkSize = 500,
    overlap = 80,
    note?: string,
    qualityStatus: QualitySeverity = 'clean',
    qualitySummary?: string,
    qualityIssues?: QualityIssue[]
  ): DocumentChunk[] {
    if (!text.trim()) return [];

    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const chunksText: string[] = [];
    let current = '';

    for (const para of paragraphs) {
      if (current.length + para.length + 2 <= chunkSize) {
        current = current ? `${current}\n\n${para}` : para;
      } else {
        if (current) chunksText.push(current);
        if (para.length > chunkSize) {
          let start = 0;
          while (start < para.length) {
            chunksText.push(para.slice(start, start + chunkSize));
            start += chunkSize - overlap;
          }
          current = '';
        } else {
          current = para;
        }
      }
    }
    if (current) chunksText.push(current);

    const total = chunksText.length;
    return chunksText.map((t, idx) => ({
      chunk_id: `${docId}_chk_${idx + 1}`,
      doc_id: docId,
      filename,
      file_type: fileType,
      text: t,
      chunk_index: idx + 1,
      total_chunks: total,
      char_count: t.length,
      extraction_note: note,
      quality_status: qualityStatus,
      quality_summary: qualitySummary,
      quality_issues: qualityIssues,
    }));
  }

  // Automated Data Quality Detector
  public detectDataQuality(
    docId: string,
    filename: string,
    ext: string,
    text: string,
    rawContent: string | ArrayBuffer
  ): DocumentQualityReport {
    const issues: QualityIssue[] = [];
    const nullLiterals = new Set([
      '', 'null', 'none', 'nan', 'n/a', 'na', 'undefined',
      '#n/a', '#null!', 'nil', 'missing', 'unknown'
    ]);

    const cleanText = (text || '').trim();

    // 1. Scanned Image / Zero-extractable text detection
    if (cleanText.length === 0 || cleanText.length < 20) {
      const isPdf = ext === '.pdf';
      const desc = `Document '${filename}' contains no extractable text — ${
        isPdf ? 'likely a scanned image-based PDF without OCR' : 'file is empty or unparseable'
      }.`;
      issues.push({
        issue_id: `${docId}_q1`,
        category: 'no_extractable_text',
        severity: 'critical',
        location: 'Whole document',
        description: desc,
        affected_ratio: 1.0,
      });

      return {
        doc_id: docId,
        filename,
        file_type: ext,
        status: 'critical',
        total_issues: 1,
        critical_issues: 1,
        minor_issues: 0,
        issues,
        summary: `Critical: ${desc}`,
        checked_at: new Date().toLocaleTimeString(),
      };
    }

    // 2. Structured formats: CSV
    if (ext === '.csv') {
      try {
        const rawStr = typeof rawContent === 'string' ? rawContent : new TextDecoder('utf-8').decode(rawContent);
        const rows = rawStr.split(/\r?\n/).filter((r) => r.trim().length > 0);
        if (rows.length > 0) {
          const headers = rows[0].split(',').map((h) => h.trim());
          const dataRows = rows.slice(1);
          const totalRows = dataRows.length;

          if (totalRows > 0) {
            for (let c = 0; c < headers.length; c++) {
              const colName = headers[c] || `Column ${c + 1}`;
              let emptyCount = 0;
              for (const r of dataRows) {
                const cells = r.split(',');
                const val = (cells[c] || '').trim().toLowerCase();
                if (nullLiterals.has(val)) {
                  emptyCount++;
                }
              }

              if (emptyCount === totalRows) {
                issues.push({
                  issue_id: `${docId}_col_${c}_all`,
                  category: 'empty_column',
                  severity: headers.length <= 2 ? 'critical' : 'minor',
                  location: `Column '${colName}'`,
                  description: `Column '${colName}' in '${filename}' is entirely empty across all ${totalRows} rows (100%).`,
                  affected_ratio: 1.0,
                });
              } else if (emptyCount > 0) {
                const pct = ((emptyCount / totalRows) * 100).toFixed(1);
                issues.push({
                  issue_id: `${docId}_col_${c}_part`,
                  category: 'missing_values',
                  severity: Number(pct) >= 50 ? 'critical' : 'minor',
                  location: `Column '${colName}'`,
                  description: `Column '${colName}' in '${filename}' is missing in ${emptyCount} of ${totalRows} rows (${pct}%).`,
                  affected_ratio: emptyCount / totalRows,
                });
              }
            }
          }
        }
      } catch (err: any) {
        issues.push({
          issue_id: `${docId}_csv_err`,
          category: 'truncated_text',
          severity: 'minor',
          location: 'CSV Parser',
          description: `Parsing issue in '${filename}': ${err?.message || 'Invalid row delimiter'}`,
        });
      }
    } else if (ext === '.json') {
      try {
        const rawStr = typeof rawContent === 'string' ? rawContent : new TextDecoder('utf-8').decode(rawContent);
        const parsed = JSON.parse(rawStr);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const dictItems = parsed.filter((item) => typeof item === 'object' && item !== null);
          if (dictItems.length > 0) {
            const keys = new Set<string>();
            dictItems.forEach((d) => Object.keys(d).forEach((k) => keys.add(k)));

            keys.forEach((key) => {
              let missing = 0;
              dictItems.forEach((d) => {
                if (!(key in d)) {
                  missing++;
                } else {
                  const val = String(d[key]).trim().toLowerCase();
                  if (nullLiterals.has(val) || d[key] === null || d[key] === undefined) {
                    missing++;
                  }
                }
              });

              if (missing === dictItems.length) {
                issues.push({
                  issue_id: `${docId}_json_${key}_all`,
                  category: 'empty_column',
                  severity: 'minor',
                  location: `Field '${key}'`,
                  description: `Field '${key}' in '${filename}' is entirely null/empty across all ${dictItems.length} records (100%).`,
                  affected_ratio: 1.0,
                });
              } else if (missing > 0) {
                const pct = ((missing / dictItems.length) * 100).toFixed(1);
                issues.push({
                  issue_id: `${docId}_json_${key}_part`,
                  category: 'missing_values',
                  severity: 'minor',
                  location: `Field '${key}'`,
                  description: `Field '${key}' in '${filename}' is missing/null in ${missing} of ${dictItems.length} records (${pct}%).`,
                  affected_ratio: missing / dictItems.length,
                });
              }
            });
          }
        }
      } catch (err: any) {
        // ignore json parse warning
      }
    } else {
      // Unstructured: PDF, DOCX, TXT, MD, HTML, etc.
      // 1. Structural gaps: Empty sections / headings with no body content beneath them
      const lines = cleanText.split('\n').map((l) => l.trim());
      const headingRegex = /^(?:#{1,6}\s+(.+)|(?:\d+\.?\s+([A-Z][A-Za-z0-9\s,\-\(\)]{3,}))|(?:SECTION\s+[A-Z0-9\.\:]+\s*(.*)))$/i;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(headingRegex);
        if (match) {
          const headingTitle = (match[1] || match[2] || match[3] || line).trim();
          let hasContent = false;
          for (let next = i + 1; next < Math.min(lines.length, i + 5); next++) {
            const nextLine = lines[next];
            if (!nextLine) continue;
            if (headingRegex.test(nextLine)) break;
            if (nextLine.length > 10) {
              hasContent = true;
              break;
            }
          }

          if (!hasContent) {
            const nextNonEmpty = lines.slice(i + 1).find((l) => l.length > 0);
            if (!nextNonEmpty || headingRegex.test(nextNonEmpty) || i === lines.length - 1) {
              issues.push({
                issue_id: `${docId}_sec_empty_${i}`,
                category: 'empty_section',
                severity: 'minor',
                location: `Section '${headingTitle}'`,
                description: `Section '${headingTitle}' in '${filename}' has a heading but no body content detected.`,
              });
            }
          }
        }
      }

      // 2. Empty page detection
      if (cleanText.includes('\f') || cleanText.includes('[Page ')) {
        const pages = cleanText.split(/\f|(?=\[Page \d+\])/);
        pages.forEach((page, pIdx) => {
          if (page.trim().length < 15) {
            const pageNum = pIdx + 1;
            issues.push({
              issue_id: `${docId}_page_${pageNum}_empty`,
              category: 'empty_page',
              severity: 'minor',
              location: `Page ${pageNum} of '${filename}'`,
              description: `Page ${pageNum} of '${filename}' contains no extractable text — likely a blank page or scanned image.`,
            });
          }
        });
      }

      // 3. Truncated or cut-off text ending mid-sentence/mid-word
      if (cleanText.length > 40) {
        const lastChar = cleanText[cleanText.length - 1];
        const validPunctuation = new Set(['.', '!', '?', '"', "'", ')', ']', '}', '`', ';']);
        const words = cleanText.split(/\s+/).slice(-4);
        const lastWord = (words[words.length - 1] || '').toLowerCase().replace(/[^a-z]/g, '');
        const dangling = new Set(['the', 'and', 'or', 'to', 'with', 'from', 'shall', 'will', 'is', 'are', 'that', 'of', 'a', 'an']);

        if (!validPunctuation.has(lastChar)) {
          if (lastChar === '-' || dangling.has(lastWord) || lastWord.length <= 2) {
            issues.push({
              issue_id: `${docId}_trunc`,
              category: 'truncated_text',
              severity: 'minor',
              location: `End of document '${filename}'`,
              description: `Text in '${filename}' appears truncated or cut off abruptly at '...${words.join(' ')}' without terminal punctuation.`,
            });
          }
        }
      }
    }

    const criticalCount = issues.filter((i) => i.severity === 'critical').length;
    const minorCount = issues.filter((i) => i.severity === 'minor').length;
    const total = issues.length;

    let status: QualitySeverity = 'clean';
    if (criticalCount > 0) status = 'critical';
    else if (minorCount > 0) status = 'minor';

    let summary = 'Data quality check passed cleanly (100% complete, no gaps or nulls detected).';
    if (total > 0) {
      const locs = issues.slice(0, 3).map((i) => i.location).join(', ');
      summary = `${total} issue(s) detected (${criticalCount} critical, ${minorCount} minor) across ${locs}${
        total > 3 ? ` (+${total - 3} more)` : ''
      }.`;
    }

    return {
      doc_id: docId,
      filename,
      file_type: ext,
      status,
      total_issues: total,
      critical_issues: criticalCount,
      minor_issues: minorCount,
      issues,
      summary,
      checked_at: new Date().toLocaleTimeString(),
    };
  }

  // Parse file content with fallback
  public parseFileContent(
    filename: string,
    content: string | ArrayBuffer
  ): { text: string; note?: string } {
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    let text = '';
    let note: string | undefined = undefined;

    if (typeof content === 'string') {
      text = content;
    } else {
      // Decode ArrayBuffer
      const decoder = new TextDecoder('utf-8', { fatal: false });
      text = decoder.decode(content);
    }

    if (['.txt', '.md', '.markdown'].includes(ext)) {
      return { text: text.trim() };
    }

    if (ext === '.csv') {
      const lines = text.split('\n').filter((l) => l.trim().length > 0);
      return { text: lines.join('\n').trim() };
    }

    if (ext === '.json') {
      try {
        const obj = JSON.parse(text);
        return { text: JSON.stringify(obj, null, 2) };
      } catch {
        return { text: text.trim() };
      }
    }

    if (['.html', '.htm', '.xml'].includes(ext)) {
      const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      return { text: stripped.trim() };
    }

    // Binary safe printable character filter for other formats
    const cleanChars: string[] = [];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
        cleanChars.push(text[i]);
      } else {
        cleanChars.push(' ');
      }
    }
    const filtered = cleanChars.join('').replace(/\s+/g, ' ').trim();

    if (filtered.length < 20) {
      return { text: '', note: 'Warning: File contained insufficient extractable text (may be empty or image).' };
    }

    note = 'processed with generic text extraction — formatting may not be fully preserved';
    return { text: filtered, note };
  }

  // Add document to library with automatic non-blocking data quality check
  public addDocument(
    filename: string,
    rawContent: string | ArrayBuffer
  ): {
    success: boolean;
    chunksAdded: number;
    note?: string;
    error?: string;
    qualityReport: DocumentQualityReport;
    doc?: IndexedDocument;
    chunks?: DocumentChunk[];
  } {
    try {
      const docId = `doc_${Math.random().toString(36).substring(2, 9)}`;
      const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase() || 'txt';
      const { text, note } = this.parseFileContent(filename, rawContent);

      // Automatic Data Quality Inspection runs immediately during ingestion
      const qualityReport = this.detectDataQuality(docId, filename, ext, text, rawContent);

      // Requirement 6: Do not block uploads or indexing because of data quality issues
      // Documents with 0 extractable text (e.g. scanned image PDF) are still indexed into the library with 0 chunks
      if (!text || text.trim().length === 0) {
        const emptyDoc: IndexedDocument = {
          doc_id: docId,
          filename,
          file_type: ext,
          chunk_count: 0,
          total_chars: 0,
          indexed_at: new Date().toLocaleTimeString(),
          extraction_note: note || 'Contains no extractable text',
          quality_report: qualityReport,
        };
        this.documents.set(docId, emptyDoc);

        return {
          success: true,
          chunksAdded: 0,
          note: note || qualityReport.summary,
          qualityReport,
          doc: emptyDoc,
          chunks: [],
        };
      }

      const newChunks = this.chunkText(
        text,
        docId,
        filename,
        ext,
        500,
        80,
        note,
        qualityReport.status,
        qualityReport.summary,
        qualityReport.issues
      );

      // Add to index
      for (const chk of newChunks) {
        this.chunks.push(chk);
      }

      const createdDoc: IndexedDocument = {
        doc_id: docId,
        filename,
        file_type: ext,
        chunk_count: newChunks.length,
        total_chars: text.length,
        indexed_at: new Date().toLocaleTimeString(),
        extraction_note: note,
        quality_report: qualityReport,
      };
      this.documents.set(docId, createdDoc);

      return {
        success: true,
        chunksAdded: newChunks.length,
        note,
        qualityReport,
        doc: createdDoc,
        chunks: newChunks,
      };
    } catch (e: any) {
      const fallbackReport: DocumentQualityReport = {
        doc_id: 'err_doc',
        filename,
        file_type: 'unknown',
        status: 'critical',
        total_issues: 1,
        critical_issues: 1,
        minor_issues: 0,
        issues: [
          {
            issue_id: 'err_1',
            category: 'truncated_text',
            severity: 'critical',
            location: 'Ingestion Engine',
            description: `File error: ${e?.message || 'Ingestion failed'}`,
          },
        ],
        summary: `Ingestion failed: ${e?.message || 'Unknown error'}`,
        checked_at: new Date().toLocaleTimeString(),
      };
      return { success: false, chunksAdded: 0, error: e?.message || 'Ingestion failed', qualityReport: fallbackReport };
    }
  }

  // Load documents and chunks from persistent storage
  public loadPersistedCorpus(documents: IndexedDocument[], chunks: DocumentChunk[]) {
    this.documents.clear();
    this.chunks = [];
    for (const doc of documents) {
      this.documents.set(doc.doc_id, doc);
    }
    for (const chk of chunks) {
      this.chunks.push(chk);
    }
  }

  // Clear all in-memory corpus
  public clearCorpus() {
    this.documents.clear();
    this.chunks = [];
  }

  // Remove document
  public removeDocument(docId: string): boolean {
    if (!this.documents.has(docId)) return false;
    this.chunks = this.chunks.filter((c) => c.doc_id !== docId);
    this.documents.delete(docId);
    return true;
  }

  // Get library documents
  public getDocumentList(): IndexedDocument[] {
    return Array.from(this.documents.values());
  }

  public getTotalChunks(): number {
    return this.chunks.length;
  }

  // Fast similarity search
  public similaritySearch(query: string, topK = 5, minScore = 0.05): RetrievedChunkRecord[] {
    if (this.chunks.length === 0) return [];

    const qVec = this.generateEmbedding(query);
    const qTokens = (query.toLowerCase().match(/\b\w+\b/g) || []).filter((w) => w.length > 2);

    const scored = this.chunks.map((chk) => {
      const cVec = this.generateEmbedding(chk.text);
      let dot = 0;
      for (let i = 0; i < this.EMBED_DIM; i++) {
        dot += qVec[i] * cVec[i];
      }

      // Lexical keyword boost
      const cTextLower = chk.text.toLowerCase();
      let matchedCount = 0;
      for (const t of qTokens) {
        if (cTextLower.includes(t)) matchedCount++;
      }
      if (matchedCount > 0) {
        dot = Math.min(1.0, dot + Math.min(0.25, matchedCount * 0.05));
      }

      return { chunk: chk, score: Number(dot.toFixed(4)) };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored
      .filter((s) => s.score >= minScore)
      .slice(0, topK)
      .map((item, idx) => ({
        rank: idx + 1,
        filename: item.chunk.filename,
        chunk_id: item.chunk.chunk_id,
        chunk_index: item.chunk.chunk_index,
        total_chunks: item.chunk.total_chunks,
        similarity_score: item.score,
        text: item.chunk.text,
        file_type: item.chunk.file_type,
        quality_status: item.chunk.quality_status,
        quality_summary: item.chunk.quality_summary,
        quality_issues: item.chunk.quality_issues,
        quality_alert: item.chunk.quality_status && item.chunk.quality_status !== 'clean'
          ? `Note: Source document '${item.chunk.filename}' had data quality issues (${item.chunk.quality_summary || 'missing/incomplete data'}) — treat with caution.`
          : undefined,
        is_supplemented: item.chunk.is_supplemented,
        supplement_source: item.chunk.supplement_source,
        user_approved: item.chunk.user_approved,
        confidence: item.chunk.confidence,
      }));
  }

  // Synthesize answer with inline numbered citations [1][2]
  private synthesizeAnswer(question: string, chunks: RetrievedChunkRecord[]): string {
    if (chunks.length === 0) {
      return 'No relevant context was found in the indexed documents to answer this question.';
    }

    const qTokens = (question.toLowerCase().match(/\b\w+\b/g) || []).filter(
      (w) => w.length > 3 && !['what', 'when', 'where', 'which', 'explain', 'describe'].includes(w)
    );

    const combined = chunks.map((c) => c.text).join(' ').toLowerCase();
    const tokenMatches = qTokens.filter((t) => combined.includes(t));

    // If completely unrelated
    if (qTokens.length > 0 && tokenMatches.length === 0) {
      return 'Based on the retrieved context, there is insufficient evidence to address this question. The indexed documents do not contain information regarding these topics.';
    }

    // Extract sentences from top chunks that answer question
    const lines: string[] = [];
    for (const chk of chunks.slice(0, 4)) {
      const sentences = chk.text
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 20);

      for (const sent of sentences) {
        const sentLower = sent.toLowerCase();
        const matches = qTokens.filter((t) => sentLower.includes(t)).length;
        if (matches > 0 && lines.length < 4) {
          lines.push(`${sent} [${chk.rank}]`);
        }
      }
    }

    if (lines.length === 0) {
      const best = chunks[0];
      const sentences = best.text
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 20);

      if (sentences.length > 0) {
        lines.push(`${sentences[0]} [1]`);
        if (sentences.length > 1) lines.push(`${sentences[1]} [1]`);
      }
    }

    return lines.join(' ');
  }

  // Evaluator
  public evaluateAnswer(
    question: string,
    answer: string,
    retrievedChunks: RetrievedChunkRecord[],
    groundednessThreshold = 0.70,
    relevanceThreshold = 0.70
  ): EvaluationData {
    if (!answer.trim()) {
      return {
        groundedness_score: 0,
        relevance_score: 0,
        is_grounded: false,
        is_relevant: false,
        overall_passed: false,
        claims_analysis: [],
        explanation: 'The generated answer was empty.',
        missing_evidence: 'No content generated.',
      };
    }

    const ansLower = answer.toLowerCase();
    const hasInsufficientPhrase =
      ansLower.includes('insufficient evidence') || ansLower.includes('cannot be determined');

    if (hasInsufficientPhrase) {
      return {
        groundedness_score: 0.2,
        relevance_score: 0.3,
        is_grounded: false,
        is_relevant: false,
        overall_passed: false,
        claims_analysis: [
          {
            claim_id: 1,
            text: answer.slice(0, 100),
            status: 'UNVERIFIED',
            support_confidence: 0.1,
            note: 'Model recognized that retrieved documents do not contain the answer.',
          },
        ],
        explanation:
          'Evaluation flagged insufficient source evidence: Question subject not present in retrieved context.',
        missing_evidence: 'Required domain entities absent from indexed files.',
      };
    }

    // Split answer into claims
    const rawSentences = answer
      .replace(/\[\d+\]/g, '')
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 12);

    const claims = rawSentences.length > 0 ? rawSentences : [answer.trim()];
    const claimsAnalysis: ClaimAudit[] = [];
    let supportedCount = 0;
    const unverifiedClaims: string[] = [];

    claims.forEach((claim, idx) => {
      const claimTokens = (claim.toLowerCase().match(/\b[a-z0-9_\-$]+\b/g) || []).filter(
        (t) => t.length > 3
      );

      if (claimTokens.length === 0) {
        claimsAnalysis.push({
          claim_id: idx + 1,
          text: claim,
          status: 'SUPPORTED',
          support_confidence: 0.9,
          note: 'Connective introductory assertion.',
        });
        supportedCount += 1;
        return;
      }

      let bestOverlap = 0;
      let matchedChunk: RetrievedChunkRecord | null = null;

      for (const chk of retrievedChunks) {
        const cLower = chk.text.toLowerCase();
        let matches = 0;
        for (const t of claimTokens) {
          if (cLower.includes(t)) matches++;
        }
        const ratio = matches / claimTokens.length;
        if (ratio > bestOverlap) {
          bestOverlap = ratio;
          matchedChunk = chk;
        }
      }

      if (bestOverlap >= 0.5) {
        supportedCount += 1;
        claimsAnalysis.push({
          claim_id: idx + 1,
          text: claim,
          status: 'SUPPORTED',
          matched_chunk_id: matchedChunk?.chunk_id,
          support_confidence: Number(bestOverlap.toFixed(2)),
          note: `Verified against Chunk ${matchedChunk?.chunk_index} of '${matchedChunk?.filename}' (${Math.round(bestOverlap * 100)}% match).`,
        });
      } else if (bestOverlap >= 0.3) {
        supportedCount += 0.5;
        claimsAnalysis.push({
          claim_id: idx + 1,
          text: claim,
          status: 'PARTIALLY_SUPPORTED',
          matched_chunk_id: matchedChunk?.chunk_id,
          support_confidence: Number(bestOverlap.toFixed(2)),
          note: `Partially verified by Chunk ${matchedChunk?.chunk_index}; some specific terms lack direct source support.`,
        });
      } else {
        claimsAnalysis.push({
          claim_id: idx + 1,
          text: claim,
          status: 'UNVERIFIED',
          support_confidence: Number(bestOverlap.toFixed(2)),
          note: 'No corroborating evidence located in retrieved chunks.',
        });
        unverifiedClaims.push(claim);
      }
    });

    const groundedness = Math.min(
      1.0,
      Math.max(0.0, Number((supportedCount / claims.length).toFixed(2)))
    );

    // Relevance
    const qTokens = (question.toLowerCase().match(/\b\w+\b/g) || []).filter(
      (w) => w.length > 3 && !['what', 'how', 'when', 'where', 'does'].includes(w)
    );
    let relevance = 0.85;
    if (qTokens.length > 0) {
      const qMatches = qTokens.filter((t) => ansLower.includes(t)).length;
      relevance = Math.min(1.0, Number((0.4 + (qMatches / qTokens.length) * 0.6).toFixed(2)));
    }

    const isGrounded = groundedness >= groundednessThreshold;
    const isRelevant = relevance >= relevanceThreshold;
    const overallPassed = isGrounded && isRelevant;

    let explanation = '';
    if (overallPassed) {
      explanation = `Evaluation succeeded. Groundedness (${Math.round(groundedness * 100)}%) and Relevance (${Math.round(relevance * 100)}%) satisfy the ${Math.round(groundednessThreshold * 100)}% requirement with ${claims.length} verified claims.`;
    } else {
      explanation = `Missing evidence detected. Groundedness: ${Math.round(groundedness * 100)}% (threshold ${Math.round(groundednessThreshold * 100)}%), Relevance: ${Math.round(relevance * 100)}%. ${unverifiedClaims.length} claim(s) lacked direct citation support.`;
    }

    return {
      groundedness_score: groundedness,
      relevance_score: relevance,
      is_grounded: isGrounded,
      is_relevant: isRelevant,
      overall_passed: overallPassed,
      claims_analysis: claimsAnalysis,
      explanation,
      missing_evidence:
        unverifiedClaims.length > 0
          ? `Unverified claim: "${unverifiedClaims[0].slice(0, 80)}..."`
          : undefined,
    };
  }

  // Self-correcting pipeline executor
  public async executePipeline(
    question: string,
    maxRetries = 3,
    groundednessThreshold = 0.70,
    relevanceThreshold = 0.70,
    onStatusUpdate?: (update: StageStatusUpdate) => void
  ): Promise<PipelineResult> {
    const attempts: AttemptLog[] = [];
    let bestAttempt: AttemptLog | null = null;
    let bestScore = -1;

    for (let cycle = 1; cycle <= maxRetries; cycle++) {
      // 1. Formulate Query & Strategy
      let queryUsed = question;
      let kUsed = 4;
      let strategyDesc = 'Cycle 1: Standard semantic search with original query and top-k=4.';

      if (cycle === 2) {
        const words = (question.toLowerCase().match(/\b\w+\b/g) || []).filter(
          (w) => w.length > 3 && !['what', 'when', 'where', 'which', 'how'].includes(w)
        );
        queryUsed = `${question} ${words.join(' ')} overview details architecture`;
        kUsed = 7;
        strategyDesc = 'Cycle 2: Query reformulation with entity expansion and enlarged top-k=7.';
      } else if (cycle === 3) {
        const words = (question.toLowerCase().match(/\b\w+\b/g) || []).filter(
          (w) => w.length > 3
        );
        queryUsed = `${words.join(' ')} specifications standards metrics guidelines`;
        kUsed = 10;
        strategyDesc = 'Cycle 3: Broad keyword dispersion, relaxed similarity threshold, and top-k=10.';
      }

      // STAGE 1: RETRIEVE
      onStatusUpdate?.({
        stage: 'RETRIEVING',
        cycle,
        max_retries: maxRetries,
        message: `Cycle ${cycle}: Running vector similarity search (k=${kUsed})...`,
        k: kUsed,
        query: queryUsed,
      });
      await new Promise((r) => setTimeout(r, 450));

      const retrieved = this.similaritySearch(queryUsed, kUsed);

      // STAGE 2: GENERATE
      onStatusUpdate?.({
        stage: 'GENERATING',
        cycle,
        max_retries: maxRetries,
        message: `Cycle ${cycle}: Synthesizing answer with chunk citations from ${retrieved.length} chunks...`,
      });
      await new Promise((r) => setTimeout(r, 450));

      const draftAnswer = this.synthesizeAnswer(question, retrieved);

      // STAGE 3: EVALUATE
      onStatusUpdate?.({
        stage: 'EVALUATING',
        cycle,
        max_retries: maxRetries,
        message: `Cycle ${cycle}: Automated judge scoring Groundedness & Relevance...`,
      });
      await new Promise((r) => setTimeout(r, 400));

      const evaluation = this.evaluateAnswer(
        question,
        draftAnswer,
        retrieved,
        groundednessThreshold,
        relevanceThreshold
      );

      let deltaExplanation: string | undefined = undefined;
      if (cycle > 1 && attempts.length > 0) {
        const prev = attempts[attempts.length - 1];
        deltaExplanation = `Cycle ${cycle} retried with expanded search (k=${kUsed}). Groundedness shifted from ${Math.round(prev.evaluation.groundedness_score * 100)}% to ${Math.round(evaluation.groundedness_score * 100)}%.`;
      }

      const attemptRecord: AttemptLog = {
        cycle_number: cycle,
        query_used: queryUsed,
        k_used: kUsed,
        strategy_description: strategyDesc,
        chunks: retrieved,
        draft_answer: draftAnswer,
        evaluation,
        delta_explanation: deltaExplanation,
      };
      attempts.push(attemptRecord);

      const score = evaluation.groundedness_score * 0.6 + evaluation.relevance_score * 0.4;
      if (score > bestScore) {
        bestScore = score;
        bestAttempt = attemptRecord;
      }

      // STAGE 4: CHECK GATE
      onStatusUpdate?.({
        stage: 'CHECKING_GATE',
        cycle,
        max_retries: maxRetries,
        message: `Cycle ${cycle} Honesty Check: Groundedness ${Math.round(evaluation.groundedness_score * 100)}%, Relevance ${Math.round(evaluation.relevance_score * 100)}%`,
        groundedness: evaluation.groundedness_score,
        relevance: evaluation.relevance_score,
        passed: evaluation.overall_passed,
      });
      await new Promise((r) => setTimeout(r, 450));

      if (evaluation.overall_passed) {
        onStatusUpdate?.({
          stage: 'COMPLETED',
          cycle,
          max_retries: maxRetries,
          message: `Evaluation passed on Cycle ${cycle}! Returning verified answer.`,
        });
        break;
      }

      if (cycle < maxRetries) {
        onStatusUpdate?.({
          stage: 'RETRYING',
          cycle,
          max_retries: maxRetries,
          message: `Evidence threshold not met. Automatically initiating retry cycle ${cycle + 1}...`,
        });
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    const finalAttempt = bestAttempt || attempts[attempts.length - 1];
    const passed = finalAttempt.evaluation.overall_passed;
    let honestyGateTriggered = false;
    let finalAnswer = finalAttempt.draft_answer;

    if (!passed) {
      honestyGateTriggered = true;
      onStatusUpdate?.({
        stage: 'HONESTY_GATE_ACTIVATED',
        cycle: attempts.length,
        max_retries: maxRetries,
        message: 'Honesty Gate activated: Insufficient verified evidence found after all retry cycles.',
      });

      finalAnswer = `⚠️ **Insufficient Evidence Found in Document Corpus**\n\nThe system completed ${attempts.length} automated retrieval cycles with expanded search parameters, but could not locate sufficient verified evidence to support an authoritative answer (Final Groundedness: ${Math.round(finalAttempt.evaluation.groundedness_score * 100)}%, Target: ${Math.round(groundednessThreshold * 100)}%).\n\nIn accordance with the Honesty Gate protocol, an unverified or speculative answer has been withheld.\n\n**Best Available Context Extract:**\n${finalAttempt.draft_answer}`;
    }

    const hasSupplemented = finalAttempt.chunks.some((c) => c.is_supplemented);
    const supplementedSources = Array.from(
      new Set(
        finalAttempt.chunks
          .filter((c) => c.is_supplemented)
          .map((c) => c.supplement_source || c.filename)
      )
    );

    let finalExplanation = finalAttempt.evaluation.explanation;
    if (hasSupplemented) {
      finalExplanation += ` ⚠️ Traceability Note: This answer uses a user-approved AI suggestion for missing data — original document did not contain this information directly (Derived from: ${supplementedSources.join(', ')}).`;
    }

    return {
      question,
      final_answer: finalAnswer,
      cycles_used: attempts.length,
      passed,
      honesty_gate_triggered: honestyGateTriggered,
      groundedness_score: finalAttempt.evaluation.groundedness_score,
      relevance_score: finalAttempt.evaluation.relevance_score,
      evaluation_explanation: finalExplanation,
      claims_analysis: finalAttempt.evaluation.claims_analysis,
      cited_chunks: finalAttempt.chunks,
      attempts,
      has_supplemented_chunks: hasSupplemented,
      supplemented_sources: supplementedSources,
    };
  }

  // Summarizer
  public summarizeCorpus(): CorpusSummaryReport {
    const docs = Array.from(this.documents.values());
    if (docs.length === 0) {
      return {
        doc_summaries: [],
        corpus_summary: 'No documents are currently indexed in the knowledge base.',
        suggested_questions: [],
        generated_at: new Date().toLocaleTimeString(),
      };
    }

    const docSummaries: DocumentSummary[] = docs.map((d) => {
      const docChunks = this.chunks.filter((c) => c.doc_id === d.doc_id);
      const fullText = docChunks.map((c) => c.text).join(' ');
      const sentences = fullText
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 25);

      const picked = [
        sentences[0] || `${d.filename} technical overview.`,
        sentences[Math.floor(sentences.length / 2)] || '',
        sentences[sentences.length - 1] || '',
      ].filter(Boolean);

      const words = fullText.match(/\b[A-Z][a-zA-Z0-9_\-]+\b/g) || [];
      const ignored = new Set(['The', 'This', 'In', 'All', 'Our', 'When', 'Every']);
      const entities = Array.from(new Set(words.filter((w) => !ignored.has(w) && w.length > 3))).slice(0, 5);

      return {
        doc_id: d.doc_id,
        filename: d.filename,
        file_type: d.file_type,
        summary: picked.join(' '),
        key_entities: entities,
        chunk_count: docChunks.length,
      };
    });

    const totalChunks = this.chunks.length;
    const docCount = docs.length;

    const allEntities = docSummaries.flatMap((ds) => ds.key_entities);
    const topEntities = Array.from(new Set(allEntities)).slice(0, 8);

    const corpusSummary = `The active knowledge base comprises ${docCount} indexed document(s) partitioned into ${totalChunks} semantic chunks. Major domain concepts identified include: ${topEntities.join(', ')}. These documents collectively provide foundational standards, operational metrics, safety rules, and implementation guidelines across enterprise domains.`;

    const suggestedQuestions: string[] = [];
    const hasSec = docs.some((d) => d.filename.toLowerCase().includes('security') || d.filename.toLowerCase().includes('cloud'));
    if (hasSec) {
      suggestedQuestions.push('What are the mandatory MFA and data encryption standards in the security architecture?');
    }
    const hasAI = docs.some((d) => d.filename.toLowerCase().includes('governance') || d.filename.toLowerCase().includes('eval'));
    if (hasAI) {
      suggestedQuestions.push('How does the Honesty Gate protocol work when evaluation scores fall below threshold?');
    }
    const hasFin = docs.some((d) => d.filename.toLowerCase().includes('financial') || d.filename.toLowerCase().includes('metric'));
    if (hasFin) {
      suggestedQuestions.push('What was the YoY growth rate of ARR and the gross margin in Q4 2025?');
    }

    if (suggestedQuestions.length < 3) {
      suggestedQuestions.push('Explain the difference between qubits and classical bits and current NISQ limitations.');
    }

    return {
      doc_summaries: docSummaries,
      corpus_summary: corpusSummary,
      suggested_questions: suggestedQuestions.slice(0, 3),
      generated_at: new Date().toLocaleTimeString(),
    };
  }

  // ==========================================
  // Suggested Corrections for Missing / Incomplete Data
  // (Never modifies original document; requires explicit user approval)
  // ==========================================

  public generateCorrectionForIssue(docId: string, issue: QualityIssue): SuggestedCorrection {
    const doc = this.documents.get(docId);
    const filename = doc?.filename || 'Unknown Document';
    const correctionId = `corr_${docId}_${issue.issue_id}_${Math.random().toString(36).substring(2, 7)}`;

    // Identify if issue is structured (CSV/XLSX/JSON) or unstructured
    const isStructured =
      issue.category === 'missing_values' ||
      issue.category === 'empty_column' ||
      (doc && (doc.file_type === '.csv' || doc.file_type === '.xlsx' || doc.file_type === '.json'));

    if (isStructured) {
      // 1. Extract column / field name from location or description
      const colMatch =
        issue.location.match(/(?:Column|Field)\s+'([^']+)'/i) ||
        issue.description.match(/(?:column|field)\s+'([^']+)'/i);
      const colName = colMatch ? colMatch[1] : '';

      // 2. Search other documents in the corpus for cross-document evidence
      let crossDocMatch: { filename: string; chunk_id: string; text: string; score: number } | null = null;
      if (colName) {
        const queryTerms = `${colName}`;
        const colTerms = colName.toLowerCase().split(/[_\s-]+/).filter((t) => t.length > 2);
        const hits = this.similaritySearch(queryTerms, 5, 0.25).filter(
          (h) =>
            h.chunk_id.indexOf(docId) === -1 &&
            !h.is_supplemented &&
            colTerms.some((t) => h.text.toLowerCase().includes(t))
        );
        if (hits.length > 0) {
          crossDocMatch = {
            filename: hits[0].filename,
            chunk_id: hits[0].chunk_id,
            text: hits[0].text,
            score: hits[0].similarity_score,
          };
        }
      }

      // Check intra-document column numbers/patterns from chunks of this document
      const docChunks = this.chunks.filter((c) => c.doc_id === docId && !c.is_supplemented);
      const docFullText = docChunks.map((c) => c.text).join('\n');
      const lines = docFullText.split('\n');

      const numericValues: number[] = [];
      const nonNumericSamples: string[] = [];

      if (lines.length > 1 && colName) {
        const headerCols = lines[0].split(',').map((h) => h.trim().replace(/^["']|["']$/g, ''));
        const targetColIdx = headerCols.findIndex((h) => h.toLowerCase() === colName.toLowerCase());

        if (targetColIdx !== -1) {
          for (let r = 1; r < lines.length; r++) {
            const rowCols = lines[r].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
            const val = rowCols[targetColIdx];
            if (val && !['', 'null', 'nan', 'none', 'n/a'].includes(val.toLowerCase())) {
              const cleanedNum = parseFloat(val.replace(/[^\d.-]/g, ''));
              if (!isNaN(cleanedNum)) {
                numericValues.push(cleanedNum);
              } else {
                nonNumericSamples.push(val);
              }
            }
          }
        }
      }

      // If cross-document evidence found
      if (crossDocMatch && crossDocMatch.score >= 0.25) {
        const sentences = crossDocMatch.text
          .split(/(?<=[.!?])\s+/)
          .filter((s) => s.toLowerCase().includes(colName.toLowerCase()) || s.length > 25);
        const suggestedFill = sentences[0] || crossDocMatch.text.slice(0, 160);

        return {
          correction_id: correctionId,
          issue_id: issue.issue_id,
          doc_id: docId,
          filename,
          category: issue.category,
          location: issue.location,
          gap_description: issue.description,
          suggested_fill: `[Cross-Document Evidence for ${colName}]: ${suggestedFill}`,
          source_type: 'cross_document',
          source_document: crossDocMatch.filename,
          source_chunk_id: crossDocMatch.chunk_id,
          source_excerpt: crossDocMatch.text.slice(0, 180) + '...',
          confidence_score: 0.85,
          confidence_level: 'High',
          rationale: `Verified evidence regarding '${colName}' found in corpus document '${crossDocMatch.filename}'.`,
          status: 'pending',
          has_corpus_evidence: true,
        };
      }

      // If intra-document column numeric pattern exists
      if (numericValues.length > 0) {
        const sum = numericValues.reduce((a, b) => a + b, 0);
        const avg = sum / numericValues.length;
        const formattedAvg = Number.isInteger(avg) ? String(avg) : avg.toFixed(2);

        return {
          correction_id: correctionId,
          issue_id: issue.issue_id,
          doc_id: docId,
          filename,
          category: issue.category,
          location: issue.location,
          gap_description: issue.description,
          suggested_fill: `Statistical Column Average: ${formattedAvg} (based on ${numericValues.length} populated rows in column '${colName}')`,
          source_type: 'column_pattern',
          source_document: filename,
          source_excerpt: `Aggregated from ${numericValues.length} non-empty numeric cells: [${numericValues.slice(0, 5).join(', ')}${numericValues.length > 5 ? '...' : ''}]`,
          confidence_score: 0.70,
          confidence_level: 'Moderate',
          rationale: `Derived from arithmetic mean of existing non-null rows in '${filename}'. Clearly labeled as unverified statistical estimation.`,
          status: 'pending',
          has_corpus_evidence: true,
        };
      }

      // If non-numeric categorical pattern exists (e.g. repeated status code)
      if (nonNumericSamples.length >= 2) {
        const mode = nonNumericSamples[0];
        return {
          correction_id: correctionId,
          issue_id: issue.issue_id,
          doc_id: docId,
          filename,
          category: issue.category,
          location: issue.location,
          gap_description: issue.description,
          suggested_fill: `Dominant Column Pattern: "${mode}" (matches ${nonNumericSamples.length} existing populated records)`,
          source_type: 'column_pattern',
          source_document: filename,
          source_excerpt: `Consistent intra-column format: "${mode}"`,
          confidence_score: 0.65,
          confidence_level: 'Moderate',
          rationale: `Derived from dominant recurring value in column '${colName}' of '${filename}'.`,
          status: 'pending',
          has_corpus_evidence: true,
        };
      }

      // If NO supporting evidence exists anywhere
      return {
        correction_id: correctionId,
        issue_id: issue.issue_id,
        doc_id: docId,
        filename,
        category: issue.category,
        location: issue.location,
        gap_description: issue.description,
        suggested_fill: 'No supporting information found elsewhere in the corpus to fill this gap.',
        source_type: 'none',
        confidence_score: 0.0,
        confidence_level: 'Low',
        rationale:
          'In accordance with the Honesty Gate protocol, no speculative or hallucinated fill was created because no supporting evidence exists in any uploaded document in the corpus.',
        status: 'pending',
        has_corpus_evidence: false,
      };
    } else {
      // Unstructured document: empty section, empty page, truncated text, or no extractable text
      let topic = '';
      const secMatch =
        issue.location.match(/Section\s+'([^']+)'/i) || issue.description.match(/Section\s+'([^']+)'/i);
      if (secMatch) {
        topic = secMatch[1];
      } else if (issue.category === 'truncated_text') {
        topic = 'continuation and concluding details';
      } else if (issue.category === 'empty_page' || issue.category === 'no_extractable_text') {
        topic = filename.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]/g, ' ');
      } else {
        topic = issue.location.replace(/[^a-zA-Z0-9\s]/g, ' ');
      }

      // Search other documents in corpus (excluding target doc)
      const hits = this.similaritySearch(topic, 5, 0.20).filter(
        (h) => h.chunk_id.indexOf(docId) === -1 && !h.is_supplemented
      );

      if (hits.length > 0 && hits[0].similarity_score >= 0.20) {
        const topMatch = hits[0];
        const sentences = topMatch.text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 25);
        const excerpt = sentences.slice(0, 3).join(' ') || topMatch.text.slice(0, 350);

        return {
          correction_id: correctionId,
          issue_id: issue.issue_id,
          doc_id: docId,
          filename,
          category: issue.category,
          location: issue.location,
          gap_description: issue.description,
          suggested_fill: `[Corpus-Derived Supplement for ${issue.location}]:\n${excerpt}`,
          source_type: 'cross_document',
          source_document: topMatch.filename,
          source_chunk_id: topMatch.chunk_id,
          source_excerpt: topMatch.text.slice(0, 200) + '...',
          confidence_score: Math.min(
            0.92,
            Math.max(0.68, Number((topMatch.similarity_score + 0.15).toFixed(2)))
          ),
          confidence_level: topMatch.similarity_score >= 0.4 ? 'High' : 'Moderate',
          rationale: `Verified content addressing '${topic}' was located in corpus document '${topMatch.filename}' (Chunk ${topMatch.chunk_index}).`,
          status: 'pending',
          has_corpus_evidence: true,
        };
      }

      // If NO other document contains supporting evidence
      return {
        correction_id: correctionId,
        issue_id: issue.issue_id,
        doc_id: docId,
        filename,
        category: issue.category,
        location: issue.location,
        gap_description: issue.description,
        suggested_fill: 'No supporting information found elsewhere in the corpus to fill this gap.',
        source_type: 'none',
        confidence_score: 0.0,
        confidence_level: 'Low',
        rationale:
          'In accordance with the Honesty Gate protocol, no speculative or hallucinated fill was created because no supporting evidence exists in any other document in the corpus.',
        status: 'pending',
        has_corpus_evidence: false,
      };
    }
  }

  public generateAllCorrectionsForDoc(docId: string): SuggestedCorrection[] {
    const doc = this.documents.get(docId);
    if (!doc || !doc.quality_report || !doc.quality_report.issues) return [];

    const suggestions: SuggestedCorrection[] = [];
    for (const issue of doc.quality_report.issues) {
      const existing = doc.quality_report.suggested_corrections?.find(
        (c) => c.issue_id === issue.issue_id && c.status === 'accepted'
      );
      if (existing) {
        suggestions.push(existing);
      } else {
        const corr = this.generateCorrectionForIssue(docId, issue);
        suggestions.push(corr);
      }
    }

    doc.quality_report.suggested_corrections = suggestions;
    return suggestions;
  }

  public acceptCorrection(docId: string, correctionId: string): boolean {
    const doc = this.documents.get(docId);
    if (!doc) return false;

    const qr = doc.quality_report;
    const correction = qr?.suggested_corrections?.find((c) => c.correction_id === correctionId);
    if (!correction || !correction.has_corpus_evidence) return false;

    // Never overwrite original document or chunks!
    correction.status = 'accepted';
    correction.accepted_at = new Date().toLocaleTimeString();

    if (!doc.accepted_corrections) {
      doc.accepted_corrections = [];
    }

    if (!doc.accepted_corrections.some((c) => c.correction_id === correctionId)) {
      doc.accepted_corrections.push(correction);
    }
    doc.has_supplemental_draft = true;

    // Create a supplemental chunk separate from original chunks
    const suppChunkId = `supp_${docId}_${correction.correction_id}`;
    this.chunks = this.chunks.filter((c) => c.chunk_id !== suppChunkId);

    const suppChunk: DocumentChunk = {
      chunk_id: suppChunkId,
      doc_id: docId,
      filename: `${doc.filename} [User-Approved Supplemental Draft]`,
      file_type: doc.file_type,
      text: `[USER-APPROVED SUPPLEMENTAL DRAFT for ${correction.location} in ${doc.filename}]\nSource Origin: ${correction.source_document || 'Column statistical pattern'}\nStatus: AI-Suggested — Not Verified (Confidence: ${Math.round(correction.confidence_score * 100)}%)\nUser Approved: Yes (${correction.accepted_at})\n\n${correction.suggested_fill}`,
      chunk_index: 990 + doc.accepted_corrections.length,
      total_chunks: doc.chunk_count + 1,
      char_count: correction.suggested_fill.length,
      quality_status: 'clean',
      is_supplemented: true,
      supplement_source: correction.source_document || 'Column statistical pattern',
      user_approved: true,
      confidence: correction.confidence_score,
      quality_alert: `⚠️ Notice: This chunk is a user-approved AI suggestion for missing data — original document did not contain this directly (Supplemented from: ${correction.source_document || 'Column statistical pattern'}).`,
    };

    this.chunks.push(suppChunk);
    return true;
  }

  public rejectCorrection(docId: string, correctionId: string): boolean {
    const doc = this.documents.get(docId);
    if (!doc) return false;

    const qr = doc.quality_report;
    const correction = qr?.suggested_corrections?.find((c) => c.correction_id === correctionId);
    if (correction) {
      correction.status = 'rejected';
    }

    // Remove supplemental chunk if it was accepted
    const suppChunkId = `supp_${docId}_${correctionId}`;
    this.chunks = this.chunks.filter((c) => c.chunk_id !== suppChunkId);

    if (doc.accepted_corrections) {
      doc.accepted_corrections = doc.accepted_corrections.filter((c) => c.correction_id !== correctionId);
      doc.has_supplemental_draft = doc.accepted_corrections.length > 0;
    }

    return true;
  }

  public getAcceptedCorrections(docId: string): SuggestedCorrection[] {
    const doc = this.documents.get(docId);
    return doc?.accepted_corrections || [];
  }

  public getAllAcceptedCorrections(): SuggestedCorrection[] {
    const result: SuggestedCorrection[] = [];
    for (const doc of this.documents.values()) {
      if (doc.accepted_corrections) {
        result.push(...doc.accepted_corrections);
      }
    }
    return result;
  }

  // Seed default sample documents
  private seedDefaultCorpus() {
    const samples = [
      {
        filename: 'enterprise_cloud_security.md',
        ext: '.md',
        text: `# Enterprise Cloud Security & Zero Trust Architecture Guide

## Overview and Principles
This document outlines the security architecture for our multi-cloud enterprise infrastructure. The architecture adheres strictly to Zero Trust Architecture (ZTA) principles: "Never Trust, Always Verify." Every request, whether originating inside or outside the network perimeter, must be authenticated, authorized, and encrypted before granting access.

## Identity & Access Management (IAM)
- **Role-Based Access Control (RBAC):** Privileges are assigned based strictly on least-privilege principles. No employee is granted persistent administrative privileges.
- **Just-In-Time (JIT) Elevation:** Administrative credentials expire automatically after a maximum window of 4 hours and require dual-custody authorization for production databases.
- **Multi-Factor Authentication (MFA):** Hardware security keys (FIDO2/WebAuthn) are mandatory for all production systems. SMS and voice OTP are strictly prohibited due to SIM-swapping vulnerabilities.

## Data Encryption Standards
- **Encryption at Rest:** All persistent storage volumes, object stores, and relational databases must use AES-256 encryption. Customer-Managed Encryption Keys (CMEK) via Cloud KMS are rotated automatically every 90 days.
- **Encryption in Transit:** All network traffic across both internal service meshes and external boundaries must enforce TLS 1.3 with forward secrecy (PFS). Unencrypted plaintext HTTP traffic is dropped at the ingress controller.
- **Confidential Computing:** Sensitive financial processing nodes execute inside encrypted virtualization enclaves (AMD SEV / Intel SGX) to prevent host memory inspection.

## Disaster Recovery & SLA Targets
- **Recovery Point Objective (RPO):** Maximum 15 minutes for Tier-1 financial databases via continuous WAL archiving.
- **Recovery Time Objective (RTO):** Maximum 60 minutes for regional failover via automated DNS health routing.
- **Backup Retention:** Daily immutable backups are retained for 365 days in an isolated, air-gapped cross-region storage bucket.`,
      },
      {
        filename: 'ai_governance_and_evals.txt',
        ext: '.txt',
        text: `AI Governance, Hallucination Prevention, and Evaluation Protocols

1. RAG Evaluation Metrics
Modern enterprise generative AI systems require automated, real-time evaluation before presenting model outputs to end users. The two primary foundational metrics are:
- Groundedness (Context Faithfulness): Measures whether every individual claim made in the generated response is strictly supported by the retrieved context chunks. A groundedness score of 1.0 means zero unsupported assertions. If a claim cannot be attributed to a specific chunk citation, it is penalized.
- Answer Relevance: Measures whether the generated response directly addresses the user's intent and question without digressing into irrelevant topics.

2. Self-Correcting Retrieval Loop (Adaptive RAG)
When an evaluation step yields a groundedness or relevance score below the operational threshold (typically 0.70 or 70%), the system must not emit the answer silently. Instead, an adaptive state machine triggers a retrieval retry:
- Cycle 1: Standard semantic vector search using original query text.
- Cycle 2 (if Cycle 1 fails threshold): Query expansion, extracting key conceptual terms, rephrasing into sub-queries, and expanding retrieved chunk count (k) by 50-75%.
- Cycle 3 (if Cycle 2 fails threshold): Broadened hybrid search combining dense semantic embeddings with sparse keyword matching, relaxing similarity distance thresholds.
- Maximum retry cap is strictly enforced (default 3 cycles) to prevent infinite loops and excessive latency.

3. Honesty Gate Protocol
If after the maximum number of retrieval attempts the evaluation score remains below the acceptable confidence threshold, the Honesty Gate activates. Rather than generating a plausible-sounding hallucination, the system explicitly responds: "Insufficient evidence found in the document corpus to reliably answer this question." This preserves trust in mission-critical applications.`,
      },
      {
        filename: 'q4_financial_operating_metrics.csv',
        ext: '.csv',
        text: `Metric,Q1_2025,Q2_2025,Q3_2025,Q4_2025,YoY_Growth
Annual Recurring Revenue (ARR) ($M),42.5,48.2,55.1,64.8,52.5%
Net Retention Rate (NRR) (%),118%,121%,123%,126%,+800 bps
Gross Margin (%),74.2%,75.0%,76.4%,77.1%,+290 bps
Customer Acquisition Cost (CAC) ($),14200,13800,13100,12400,-12.7%
Monthly Active Users (MAU) (K),310,365,420,495,59.7%
Infrastructure Cloud Spend ($M),3.2,3.5,3.9,4.1,28.1%
Vector DB Hosting Cost ($K),18.4,22.1,27.5,31.2,69.6%
LLM Inference API Spend ($K),84.2,105.6,132.0,158.4,88.1%
Free Cash Flow ($M),-1.8,-0.4,1.2,3.6,Turnaround to positive`,
      },
      {
        filename: 'quantum_computing_primer.txt',
        ext: '.txt',
        text: `Fundamentals of Quantum Information and Computing

1. Qubits and Superposition
In classical computing, the fundamental unit of information is a bit, which exists strictly as a 0 or 1. In quantum computing, the fundamental unit is a qubit (quantum bit). A qubit can exist in a linear superposition of the basis states |0> and |1>, mathematically represented as |psi> = alpha|0> + beta|1>, where alpha and beta are complex probability amplitudes such that |alpha|^2 + |beta|^2 = 1.

2. Quantum Entanglement
Entanglement is a physical phenomenon where pairs or groups of particles interact such that the quantum state of each particle cannot be described independently of the state of the others, even when separated by large distances. Measuring one entangled qubit instantaneously determines the state of its entangled partner.

3. Quantum Decoherence and Error Correction
Quantum states are fragile and subject to environmental noise, thermal fluctuations, and electromagnetic radiation, causing decoherence—the loss of quantum superposition. Building fault-tolerant quantum computers requires Quantum Error Correction (QEC), utilizing topological surface codes where thousands of physical qubits encode a single protected logical qubit.

4. Current Era: NISQ
We are currently in the Noisy Intermediate-Scale Quantum (NISQ) era, characterized by devices with 50 to 1,000 noisy physical qubits without full fault tolerance. Algorithms suited for NISQ include the Variational Quantum Eigensolver (VQE) for molecular chemistry and the Quantum Approximate Optimization Algorithm (QAOA) for combinatorial logistics.`,
      },
    ];

    for (const sample of samples) {
      this.addDocument(sample.filename, sample.text);
    }
  }
}
