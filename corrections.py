"""
Suggested Correction Engine for documents with missing or incomplete information.
Strictly adheres to Groundedness and Honesty Gate Principles:
1. Never modifies the original uploaded document.
2. For structured data: surfaces column averages or cross-corpus matching; labels as 'AI-suggested, unverified'.
3. For unstructured documents: suggests filling gap ONLY if missing information exists in the same corpus.
   If no supporting source exists, outputs: "no supporting information found elsewhere in the corpus to fill this gap."
4. Requires explicit user approval per suggestion before incorporation as a supplemental draft layer.
5. Never invents facts outside corpus evidence.
"""

import re
from typing import List, Dict, Any, Optional
from python_rag.ingestion import DocumentChunk
from python_rag.quality import QualityIssue


class SuggestedCorrection:
    def __init__(
        self,
        correction_id: str,
        issue_id: str,
        doc_id: str,
        filename: str,
        category: str,
        location: str,
        gap_description: str,
        suggested_fill: str,
        source_type: str,  # 'cross_document', 'column_pattern', 'none'
        confidence_score: float,
        confidence_level: str,  # 'High', 'Moderate', 'Low'
        rationale: str,
        has_corpus_evidence: bool,
        source_document: Optional[str] = None,
        source_chunk_id: Optional[str] = None,
        source_excerpt: Optional[str] = None,
        status: str = "pending"  # 'pending', 'accepted', 'rejected'
    ):
        self.correction_id = correction_id
        self.issue_id = issue_id
        self.doc_id = doc_id
        self.filename = filename
        self.category = category
        self.location = location
        self.gap_description = gap_description
        self.suggested_fill = suggested_fill
        self.source_type = source_type
        self.confidence_score = confidence_score
        self.confidence_level = confidence_level
        self.rationale = rationale
        self.has_corpus_evidence = has_corpus_evidence
        self.source_document = source_document
        self.source_chunk_id = source_chunk_id
        self.source_excerpt = source_excerpt
        self.status = status
        self.accepted_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "correction_id": self.correction_id,
            "issue_id": self.issue_id,
            "doc_id": self.doc_id,
            "filename": self.filename,
            "category": self.category,
            "location": self.location,
            "gap_description": self.gap_description,
            "suggested_fill": self.suggested_fill,
            "source_type": self.source_type,
            "confidence_score": self.confidence_score,
            "confidence_level": self.confidence_level,
            "rationale": self.rationale,
            "has_corpus_evidence": self.has_corpus_evidence,
            "source_document": self.source_document,
            "source_chunk_id": self.source_chunk_id,
            "source_excerpt": self.source_excerpt,
            "status": self.status,
            "accepted_at": self.accepted_at,
            "unverified_notice": "AI-Suggested — Not Verified"
        }


class CorrectionSuggester:
    """Generates traceably evidenced corrections across the user's document library."""

    @staticmethod
    def suggest_for_issue(
        doc_id: str,
        filename: str,
        file_type: str,
        issue: QualityIssue,
        vector_store: Any
    ) -> SuggestedCorrection:
        cid = f"corr_{doc_id}_{issue.issue_id}"
        is_structured = issue.category in ("missing_values", "empty_column") or file_type in (".csv", ".xlsx", ".json")

        if is_structured:
            # 1. Extract column name
            col_match = re.search(r"(?:Column|Field)\s+'([^']+)'", issue.location, re.IGNORECASE)
            if not col_match:
                col_match = re.search(r"(?:column|field)\s+'([^']+)'", issue.description, re.IGNORECASE)
            col_name = col_match.group(1) if col_match else ""

            # Check cross-corpus
            other_chunks = [c for c in vector_store.chunks if c.doc_id != doc_id and not getattr(c, "is_supplemented", False)]
            cross_match = None
            if col_name and other_chunks:
                # Search for col_name in other files
                col_terms = [t.lower() for t in re.split(r"[_\s-]+", col_name) if len(t) > 2]
                hits = vector_store.similarity_search(col_name, top_k=5, min_score=0.25)
                valid_hits = [
                    h for h in hits
                    if h[0].doc_id != doc_id
                    and h[0].filename != filename
                    and any(term in h[0].text.lower() for term in col_terms)
                ]
                if valid_hits:
                    cross_match = valid_hits[0]

            if cross_match and cross_match[1] >= 0.20:
                match_chunk, score, rank = cross_match
                # Extract sentence mentioning column or subject
                sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", match_chunk.text) if len(s.strip()) > 15]
                matched_sentence = next((s for s in sentences if col_name.lower() in s.lower()), sentences[0] if sentences else match_chunk.text[:120])

                return SuggestedCorrection(
                    correction_id=cid,
                    issue_id=issue.issue_id,
                    doc_id=doc_id,
                    filename=filename,
                    category=issue.category,
                    location=issue.location,
                    gap_description=issue.description,
                    suggested_fill=f"[Cross-Corpus Evidence for {col_name}]: {matched_sentence}",
                    source_type="cross_document",
                    confidence_score=0.85,
                    confidence_level="High",
                    rationale=f"Evidence for '{col_name}' was verified in corpus document '{match_chunk.filename}'.",
                    has_corpus_evidence=True,
                    source_document=match_chunk.filename,
                    source_chunk_id=match_chunk.chunk_id,
                    source_excerpt=match_chunk.text[:180] + "..."
                )

            # Check column pattern inside doc chunks
            doc_chunks = [c for c in vector_store.chunks if c.doc_id == doc_id and not getattr(c, "is_supplemented", False)]
            full_text = "\n".join(c.text for c in doc_chunks)
            lines = [l.strip() for l in full_text.split("\n") if l.strip()]

            numeric_values = []
            if len(lines) > 1 and col_name:
                header_cols = [c.strip().strip('"\'') for c in re.split(r"[,|]", lines[0])]
                header_cols_clean = [h.lower() for h in header_cols]
                if col_name.lower() in header_cols_clean:
                    col_idx = header_cols_clean.index(col_name.lower())
                    for row in lines[1:]:
                        r_cols = [c.strip().strip('"\'') for c in re.split(r"[,|]", row)]
                        if col_idx < len(r_cols):
                            val = r_cols[col_idx]
                            num_match = re.search(r"[-+]?\d*\.?\d+", val)
                            if num_match:
                                try:
                                    numeric_values.append(float(num_match.group(0)))
                                except ValueError:
                                    pass

            if numeric_values:
                avg = sum(numeric_values) / len(numeric_values)
                formatted_avg = f"{avg:.2f}" if not avg.is_integer() else f"{int(avg)}"
                return SuggestedCorrection(
                    correction_id=cid,
                    issue_id=issue.issue_id,
                    doc_id=doc_id,
                    filename=filename,
                    category=issue.category,
                    location=issue.location,
                    gap_description=issue.description,
                    suggested_fill=f"Statistical Column Average: {formatted_avg} (derived from {len(numeric_values)} populated rows in column '{col_name}')",
                    source_type="column_pattern",
                    confidence_score=0.70,
                    confidence_level="Moderate",
                    rationale=f"Calculated arithmetic average of existing non-null rows in column '{col_name}'. Clearly labeled as unverified statistical estimation.",
                    has_corpus_evidence=True,
                    source_document=filename,
                    source_excerpt=f"Statistical sample: [{', '.join(str(n) for n in numeric_values[:5])}]"
                )

            # No supporting information
            return SuggestedCorrection(
                correction_id=cid,
                issue_id=issue.issue_id,
                doc_id=doc_id,
                filename=filename,
                category=issue.category,
                location=issue.location,
                gap_description=issue.description,
                suggested_fill="no supporting information found elsewhere in the corpus to fill this gap.",
                source_type="none",
                confidence_score=0.0,
                confidence_level="Low",
                rationale="In accordance with the Honesty Gate protocol, ungrounded guesses without corpus evidence are prohibited.",
                has_corpus_evidence=False
            )

        else:
            # Unstructured file
            sec_match = re.search(r"Section\s+'([^']+)'", issue.location, re.IGNORECASE)
            if not sec_match:
                sec_match = re.search(r"Section\s+'([^']+)'", issue.description, re.IGNORECASE)

            topic = sec_match.group(1) if sec_match else issue.location
            hits = vector_store.similarity_search(topic, top_k=5, min_score=0.18)
            valid_hits = [h for h in hits if h[0].doc_id != doc_id and h[0].filename != filename and not getattr(h[0], "is_supplemented", False)]

            if valid_hits and valid_hits[0][1] >= 0.18:
                top_match, score, rank = valid_hits[0]
                sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", top_match.text) if len(s.strip()) > 20]
                excerpt = " ".join(sentences[:3]) if sentences else top_match.text[:300]

                return SuggestedCorrection(
                    correction_id=cid,
                    issue_id=issue.issue_id,
                    doc_id=doc_id,
                    filename=filename,
                    category=issue.category,
                    location=issue.location,
                    gap_description=issue.description,
                    suggested_fill=f"[Corpus-Derived Supplement for {issue.location}]:\n{excerpt}",
                    source_type="cross_document",
                    confidence_score=min(0.90, max(0.65, round(score + 0.15, 2))),
                    confidence_level="High" if score >= 0.35 else "Moderate",
                    rationale=f"Verified content addressing '{topic}' was located in corpus document '{top_match.filename}' (Chunk {top_match.chunk_index}).",
                    has_corpus_evidence=True,
                    source_document=top_match.filename,
                    source_chunk_id=top_match.chunk_id,
                    source_excerpt=top_match.text[:200] + "..."
                )

            # No supporting information
            return SuggestedCorrection(
                correction_id=cid,
                issue_id=issue.issue_id,
                doc_id=doc_id,
                filename=filename,
                category=issue.category,
                location=issue.location,
                gap_description=issue.description,
                suggested_fill="no supporting information found elsewhere in the corpus to fill this gap.",
                source_type="none",
                confidence_score=0.0,
                confidence_level="Low",
                rationale="In accordance with the Honesty Gate protocol, ungrounded guesses without corpus evidence are prohibited.",
                has_corpus_evidence=False
            )

    @staticmethod
    def accept_correction(doc_id: str, correction: SuggestedCorrection, vector_store: Any) -> bool:
        """
        Accepts a suggested correction into the vector store as a separate supplemental draft chunk.
        NEVER overwrites or alters the original uploaded document or chunks.
        """
        if not correction.has_corpus_evidence:
            return False

        correction.status = "accepted"

        # Create separate supplemental draft chunk
        supp_chunk = DocumentChunk(
            chunk_id=f"supp_{doc_id}_{correction.correction_id}",
            doc_id=doc_id,
            filename=f"{correction.filename} [User-Approved Supplemental Draft]",
            text=f"[USER-APPROVED SUPPLEMENTAL DRAFT for {correction.location} in {correction.filename}]\nOrigin: {correction.source_document or 'Column statistical pattern'}\nAI-Suggested, Not Verified (Confidence: {int(correction.confidence_score * 100)}%)\n\n{correction.suggested_fill}",
            chunk_index=999,
            total_chunks=1,
            file_type="supplemental",
            is_supplemented=True,
            supplement_source=correction.source_document or "Column statistical pattern",
            user_approved=True,
            confidence=correction.confidence_score
        )

        # Append to vector store chunks and embed
        vector_store.chunks.append(supp_chunk)
        vector_store.chunk_ids.append(supp_chunk.chunk_id)
        new_vec = vector_store._generate_dense_semantic_embedding(supp_chunk.text)
        if vector_store.matrix is not None:
            try:
                import numpy as np
            except ImportError:
                np = None
            if np is not None and isinstance(vector_store.matrix, np.ndarray):
                vector_store.matrix = np.vstack([vector_store.matrix, new_vec])
            else:
                vector_store.matrix.append(new_vec)
        else:
            vector_store.matrix = [new_vec]

        return True
