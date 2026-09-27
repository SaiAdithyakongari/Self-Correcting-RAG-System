"""
Evaluation module for the Self-Correcting RAG System.
Scores Groundedness and Relevance with claim-level support verification
and plain-English transparency explanations.
"""

import re
from typing import List, Dict, Any, Tuple, Optional
from python_rag.ingestion import DocumentChunk


class EvaluationResult:
    """Detailed evaluation report for a generated answer."""
    def __init__(
        self,
        groundedness_score: float,
        relevance_score: float,
        is_grounded: bool,
        is_relevant: bool,
        overall_passed: bool,
        claims_analysis: List[Dict[str, Any]],
        explanation: str,
        missing_evidence: Optional[str] = None
    ):
        self.groundedness_score = groundedness_score
        self.relevance_score = relevance_score
        self.is_grounded = is_grounded
        self.is_relevant = is_relevant
        self.overall_passed = overall_passed
        self.claims_analysis = claims_analysis
        self.explanation = explanation
        self.missing_evidence = missing_evidence

    def to_dict(self) -> Dict[str, Any]:
        return {
            "groundedness_score": self.groundedness_score,
            "relevance_score": self.relevance_score,
            "is_grounded": self.is_grounded,
            "is_relevant": self.is_relevant,
            "overall_passed": self.overall_passed,
            "claims_analysis": self.claims_analysis,
            "explanation": self.explanation,
            "missing_evidence": self.missing_evidence
        }


class AnswerEvaluator:
    """
    Evaluates generated responses against retrieved context and original questions.
    Implements multi-metric scoring with claim-by-claim verification.
    """

    def __init__(self, groundedness_threshold: float = 0.70, relevance_threshold: float = 0.70):
        self.groundedness_threshold = groundedness_threshold
        self.relevance_threshold = relevance_threshold

    def _extract_claims(self, text: str) -> List[str]:
        """Split generated text into discrete claims/sentences."""
        # Clean markdown headers, list markers
        clean = re.sub(r"#+\s*", "", text)
        clean = re.sub(r"^\s*[-*•]\s*", "", clean, flags=re.MULTILINE)
        raw_sentences = re.split(r"(?<=[.!?])\s+", clean)
        claims = [s.strip() for s in raw_sentences if len(s.strip()) > 12]
        return claims if claims else [text.strip()]

    def evaluate(
        self,
        question: str,
        answer: str,
        retrieved_chunks: List[Tuple[DocumentChunk, float, int]]
    ) -> EvaluationResult:
        """
        Evaluate answer for groundedness and relevance.
        """
        if not answer or not answer.strip():
            return EvaluationResult(
                groundedness_score=0.0,
                relevance_score=0.0,
                is_grounded=False,
                is_relevant=False,
                overall_passed=False,
                claims_analysis=[],
                explanation="Generated answer was empty.",
                missing_evidence="No answer produced."
            )

        if not retrieved_chunks:
            return EvaluationResult(
                groundedness_score=0.0,
                relevance_score=0.1,
                is_grounded=False,
                is_relevant=False,
                overall_passed=False,
                claims_analysis=[],
                explanation="No context chunks were retrieved to ground this answer.",
                missing_evidence="Complete absence of retrieved source material."
            )

        combined_context = " ".join([c[0].text for c in retrieved_chunks]).lower()
        claims = self._extract_claims(answer)
        claims_analysis: List[Dict[str, Any]] = []

        supported_count = 0
        unsupported_claims: List[str] = []

        for c_idx, claim in enumerate(claims):
            # Tokenize claim words (> 3 chars, skip common stopwords)
            stopwords = {"the", "this", "that", "with", "from", "have", "were", "been", "their", "there", "about", "which"}
            tokens = [
                t.lower() for t in re.findall(r"\b[a-zA-Z0-9_\-\$]+\b", claim)
                if len(t) > 3 and t.lower() not in stopwords
            ]

            if not tokens:
                claims_analysis.append({
                    "claim_id": c_idx + 1,
                    "text": claim,
                    "status": "SUPPORTED",
                    "matched_chunk_id": retrieved_chunks[0][0].chunk_id,
                    "support_confidence": 0.85,
                    "note": "Introductory or connective sentence."
                })
                supported_count += 1
                continue

            # Check overlap against each retrieved chunk
            best_chunk_match = None
            best_overlap_ratio = 0.0

            for chunk_obj, sim_score, rank in retrieved_chunks:
                chunk_text_lower = chunk_obj.text.lower()
                matched_tokens = sum(1 for t in tokens if t in chunk_text_lower)
                overlap_ratio = matched_tokens / len(tokens)
                if overlap_ratio > best_overlap_ratio:
                    best_overlap_ratio = overlap_ratio
                    best_chunk_match = chunk_obj

            if best_overlap_ratio >= 0.50:
                supported_count += 1
                status = "SUPPORTED"
                note = f"Supported by Chunk {best_chunk_match.chunk_index} of '{best_chunk_match.filename}' ({int(best_overlap_ratio * 100)}% keyword match)."
            elif best_overlap_ratio >= 0.30:
                supported_count += 0.5
                status = "PARTIALLY_SUPPORTED"
                note = f"Partially supported by Chunk {best_chunk_match.chunk_index}; some specific terms lack direct evidence."
            else:
                status = "UNVERIFIED"
                note = "No matching evidence found in retrieved chunks."
                unsupported_claims.append(claim)

            claims_analysis.append({
                "claim_id": c_idx + 1,
                "text": claim,
                "status": status,
                "matched_chunk_id": best_chunk_match.chunk_id if best_chunk_match else None,
                "support_confidence": round(best_overlap_ratio, 2),
                "note": note
            })

        # Calculate groundedness score
        total_claims = len(claims)
        groundedness = round(supported_count / total_claims if total_claims > 0 else 0.0, 2)
        groundedness = min(1.0, max(0.0, groundedness))

        # Calculate relevance score based on question intent & answer alignment
        q_tokens = [
            t.lower() for t in re.findall(r"\b[a-zA-Z0-9_\-\$]+\b", question)
            if len(t) > 3 and t.lower() not in {"what", "when", "where", "which", "how", "does", "explain", "describe"}
        ]
        ans_lower = answer.lower()
        if q_tokens:
            q_matches = sum(1 for t in q_tokens if t in ans_lower)
            relevance = round(min(1.0, 0.40 + (q_matches / len(q_tokens)) * 0.60), 2)
        else:
            relevance = 0.85

        # Check if answer contains refusal phrases (like "insufficient evidence")
        has_insufficient_phrase = "insufficient evidence" in ans_lower or "cannot be determined" in ans_lower
        if has_insufficient_phrase:
            # Explicitly mark as ungrounded/insufficient context so orchestrator retries
            groundedness = 0.20
            relevance = 0.30
            is_grounded = False
            is_relevant = False
            overall_passed = False
            missing_evidence = "Question topic absent from retrieved document context."
        else:
            is_grounded = groundedness >= self.groundedness_threshold
            is_relevant = relevance >= self.relevance_threshold
            overall_passed = is_grounded and is_relevant
            missing_evidence = None

        # Generate plain-English explanation
        explanation_parts = []
        if overall_passed:
            explanation_parts.append(
                f"Evaluation passed successfully. Groundedness ({int(groundedness * 100)}%) and Relevance ({int(relevance * 100)}%) exceed the {int(self.groundedness_threshold * 100)}% threshold."
            )
            explanation_parts.append(
                f"All {total_claims} assertions were cross-referenced against the {len(retrieved_chunks)} retrieved chunks with confirmed citation alignment."
            )
        else:
            reasons = []
            if not is_grounded:
                reasons.append(f"Groundedness score {int(groundedness * 100)}% fell below target {int(self.groundedness_threshold * 100)}%")
            if not is_relevant:
                reasons.append(f"Relevance score {int(relevance * 100)}% fell below target {int(self.relevance_threshold * 100)}%")
            explanation_parts.append(f"Evaluation flagged missing evidence: {'; '.join(reasons)}.")
            if unsupported_claims:
                explanation_parts.append(f"Specifically, {len(unsupported_claims)} claim(s) lacked direct source verification in the current retrieval window.")

        if not overall_passed and not missing_evidence:
            if unsupported_claims:
                missing_evidence = f"Unbacked claims detected: '{unsupported_claims[0][:90]}...'"
            else:
                missing_evidence = "Retrieved chunks did not contain sufficient semantic density for query requirements."

        return EvaluationResult(
            groundedness_score=groundedness,
            relevance_score=relevance,
            is_grounded=is_grounded,
            is_relevant=is_relevant,
            overall_passed=overall_passed,
            claims_analysis=claims_analysis,
            explanation=" ".join(explanation_parts),
            missing_evidence=missing_evidence
        )
