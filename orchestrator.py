"""
Self-Correcting RAG Orchestration Engine and State Machine.
Coordinates the iterative Retrieve -> Generate -> Evaluate -> Retry loop,
manages adaptive query rephrasing, enforces the Honesty Gate,
and maintains full answer traceability across all attempts.
"""

import os
import re
import json
from enum import Enum
from typing import List, Dict, Any, Tuple, Optional, Callable
from python_rag.ingestion import DocumentChunk
from python_rag.vector_store import VectorStore
from python_rag.evaluator import AnswerEvaluator, EvaluationResult


class PipelineState(str, Enum):
    IDLE = "IDLE"
    RETRIEVING = "RETRIEVING"
    GENERATING = "GENERATING"
    EVALUATING = "EVALUATING"
    CHECKING_GATE = "CHECKING_GATE"
    RETRYING = "RETRYING"
    COMPLETED = "COMPLETED"
    HONESTY_GATE_ACTIVATED = "HONESTY_GATE_ACTIVATED"


class RetrievalAttempt:
    """Record of a single cycle in the self-correcting loop."""
    def __init__(
        self,
        cycle_number: int,
        query_used: str,
        k_used: int,
        strategy_description: str,
        chunks: List[Tuple[DocumentChunk, float, int]],
        draft_answer: str,
        evaluation: EvaluationResult,
        delta_explanation: Optional[str] = None
    ):
        self.cycle_number = cycle_number
        self.query_used = query_used
        self.k_used = k_used
        self.strategy_description = strategy_description
        self.chunks = chunks
        self.draft_answer = draft_answer
        self.evaluation = evaluation
        self.delta_explanation = delta_explanation

    def to_dict(self) -> Dict[str, Any]:
        return {
            "cycle_number": self.cycle_number,
            "query_used": self.query_used,
            "k_used": self.k_used,
            "strategy_description": self.strategy_description,
            "chunks": [
                {
                    "chunk_id": c[0].chunk_id,
                    "filename": c[0].filename,
                    "chunk_index": c[0].chunk_index,
                    "total_chunks": c[0].total_chunks,
                    "similarity_score": c[1],
                    "rank": c[2],
                    "text": c[0].text,
                    "quality_status": getattr(c[0], "quality_status", "clean"),
                    "quality_summary": getattr(c[0], "quality_summary", None),
                    "quality_issues": getattr(c[0], "quality_issues", [])
                }
                for c in self.chunks
            ],
            "draft_answer": self.draft_answer,
            "evaluation": self.evaluation.to_dict(),
            "delta_explanation": self.delta_explanation
        }


class SelfCorrectingRAG:
    """
    Inspectable state machine orchestrating self-correcting RAG.
    """

    def __init__(
        self,
        vector_store: VectorStore,
        evaluator: Optional[AnswerEvaluator] = None,
        max_retries: int = 3,
        groundedness_threshold: float = 0.70,
        relevance_threshold: float = 0.70
    ):
        self.vector_store = vector_store
        self.evaluator = evaluator or AnswerEvaluator(
            groundedness_threshold=groundedness_threshold,
            relevance_threshold=relevance_threshold
        )
        self.max_retries = max_retries
        self.groundedness_threshold = groundedness_threshold
        self.relevance_threshold = relevance_threshold
        self.state = PipelineState.IDLE

    def _reformulate_query(self, original_query: str, cycle: int, previous_attempt: Optional[RetrievalAttempt]) -> Tuple[str, int, str]:
        """
        Produce an adjusted query and k for retry cycles.
        Cycle 2: Entity expansion and semantic focus (k=7).
        Cycle 3: Broad keyword dispersion and contextual fallback (k=10).
        """
        if cycle == 1:
            return original_query, 4, "Initial direct query with standard top-k=4."

        # Extract core words
        words = re.findall(r"\b\w+\b", original_query.lower())
        stopwords = {"what", "is", "the", "are", "how", "does", "can", "explain", "in", "of", "and", "to", "a", "for"}
        key_terms = [w for w in words if w not in stopwords and len(w) > 2]

        if cycle == 2:
            expanded_query = f"{original_query} {' '.join(key_terms)} overview principles details"
            strat = "Cycle 2: Query rephrasing with keyword enrichment and expanded top-k=7."
            return expanded_query, 7, strat

        # Cycle 3
        broad_query = f"{' '.join(key_terms)} summary architecture specification metrics guidelines"
        strat = "Cycle 3: Maximum recall expansion, relaxed distance threshold, and top-k=10."
        return broad_query, 10, strat

    def _synthesize_answer(self, question: str, chunks: List[Tuple[DocumentChunk, float, int]]) -> str:
        """
        Generate answer with inline numbered citations [1], [2] referencing specific chunks.
        Synthesizes factual claims directly grounded in retrieved text.
        """
        if not chunks:
            return "No relevant context was found in the indexed documents to answer this question."

        # Check if question topic exists in context
        q_tokens = [w.lower() for w in re.findall(r"\b\w+\b", question) if len(w) > 3]
        combined_text = " ".join([c[0].text for c in chunks])
        combined_lower = combined_text.lower()

        # If question has zero relevance to any chunk, trigger honest missing evidence
        matched_tokens = [t for t in q_tokens if t in combined_lower]
        if q_tokens and len(matched_tokens) == 0:
            return "Based on the retrieved context, there is insufficient evidence to address this question. The indexed documents do not contain information regarding these topics."

        # Extract relevant statements from top chunks
        lines = []
        citations_used = []

        for chunk_obj, score, rank in chunks[:4]:
            sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", chunk_obj.text) if len(s.strip()) > 20]
            # Find sentences with matching question tokens
            for sent in sentences:
                sent_lower = sent.lower()
                matches = sum(1 for t in q_tokens if t in sent_lower)
                if matches > 0 and len(lines) < 4:
                    lines.append(f"{sent} [{rank}]")
                    citations_used.append(rank)

        if not lines:
            # Fall back to using highest ranked chunk sentences
            best_chunk = chunks[0][0]
            sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", best_chunk.text) if len(s.strip()) > 20]
            if sentences:
                lines.append(f"{sentences[0]} [1]")
                if len(sentences) > 1:
                    lines.append(f"{sentences[1]} [1]")
            citations_used.append(1)

        answer_text = " ".join(lines)
        return answer_text

    def run(
        self,
        question: str,
        status_callback: Optional[Callable[[PipelineState, Dict[str, Any]], None]] = None
    ) -> Dict[str, Any]:
        """
        Execute the full self-correcting RAG pipeline.
        Yields status updates via status_callback if provided.
        """
        attempts: List[RetrievalAttempt] = []
        best_attempt: Optional[RetrievalAttempt] = None
        best_combined_score: float = -1.0

        for cycle in range(1, self.max_retries + 1):
            prev_attempt = attempts[-1] if attempts else None
            query_used, k_used, strategy_desc = self._reformulate_query(question, cycle, prev_attempt)

            # 1. RETRIEVE
            self.state = PipelineState.RETRIEVING
            if status_callback:
                status_callback(self.state, {
                    "cycle": cycle,
                    "max_retries": self.max_retries,
                    "query": query_used,
                    "k": k_used,
                    "strategy": strategy_desc
                })

            retrieved_chunks = self.vector_store.similarity_search(query_used, top_k=k_used)

            # 2. GENERATE
            self.state = PipelineState.GENERATING
            if status_callback:
                status_callback(self.state, {
                    "cycle": cycle,
                    "chunk_count": len(retrieved_chunks)
                })

            draft_answer = self._synthesize_answer(question, retrieved_chunks)

            # 3. EVALUATE
            self.state = PipelineState.EVALUATING
            if status_callback:
                status_callback(self.state, {
                    "cycle": cycle,
                    "answer_preview": draft_answer[:80]
                })

            eval_res = self.evaluator.evaluate(question, draft_answer, retrieved_chunks)

            # Delta explanation if this is a retry
            delta_expl = None
            if cycle > 1 and prev_attempt:
                g_diff = eval_res.groundedness_score - prev_attempt.evaluation.groundedness_score
                delta_expl = (
                    f"Cycle {cycle} retried with expanded search (k={k_used}). "
                    f"Groundedness changed from {int(prev_attempt.evaluation.groundedness_score * 100)}% "
                    f"to {int(eval_res.groundedness_score * 100)}%."
                )

            attempt = RetrievalAttempt(
                cycle_number=cycle,
                query_used=query_used,
                k_used=k_used,
                strategy_description=strategy_desc,
                chunks=retrieved_chunks,
                draft_answer=draft_answer,
                evaluation=eval_res,
                delta_explanation=delta_expl
            )
            attempts.append(attempt)

            # Track best attempt
            combined_score = (eval_res.groundedness_score * 0.6) + (eval_res.relevance_score * 0.4)
            if combined_score > best_combined_score:
                best_combined_score = combined_score
                best_attempt = attempt

            # 4. CHECK GATE
            self.state = PipelineState.CHECKING_GATE
            if status_callback:
                status_callback(self.state, {
                    "cycle": cycle,
                    "groundedness": eval_res.groundedness_score,
                    "relevance": eval_res.relevance_score,
                    "passed": eval_res.overall_passed
                })

            if eval_res.overall_passed:
                # Successfully grounded and relevant!
                self.state = PipelineState.COMPLETED
                break

            # If not passed and retries remain, trigger RETRY
            if cycle < self.max_retries:
                self.state = PipelineState.RETRYING
                if status_callback:
                    status_callback(self.state, {
                        "cycle": cycle,
                        "next_cycle": cycle + 1,
                        "reason": eval_res.missing_evidence or "Scores below target threshold."
                    })

        # Final outcome determination & Honesty Gate
        final_attempt = best_attempt or attempts[-1]
        passed = final_attempt.evaluation.overall_passed
        honesty_gate_triggered = False

        final_answer = final_attempt.draft_answer
        if not passed:
            honesty_gate_triggered = True
            self.state = PipelineState.HONESTY_GATE_ACTIVATED
            final_answer = (
                "⚠️ **Insufficient Evidence Found in Document Corpus**\n\n"
                "The system completed 3 automated retrieval cycles but could not locate sufficient verified evidence "
                f"to support an authoritative response (Groundedness: {int(final_attempt.evaluation.groundedness_score * 100)}%, "
                f"Relevance: {int(final_attempt.evaluation.relevance_score * 100)}%). "
                "In accordance with our Honesty Gate protocol, an ungrounded or speculative answer has been withheld.\n\n"
                f"**Best Available Context Extract:**\n{final_attempt.draft_answer}"
            )
        else:
            self.state = PipelineState.COMPLETED

        if status_callback:
            status_callback(self.state, {
                "cycles_used": len(attempts),
                "passed": passed,
                "honesty_gate": honesty_gate_triggered
            })

        # Collect cited sources with Data Quality alerts and user-approved suggestions
        cited_chunks = []
        quality_caveats = []
        for c, score, rank in final_attempt.chunks:
            q_status = getattr(c, "quality_status", "clean")
            q_summary = getattr(c, "quality_summary", None)
            q_issues = getattr(c, "quality_issues", [])
            is_supp = getattr(c, "is_supplemented", False)
            supp_source = getattr(c, "supplement_source", None)
            q_alert = None

            if is_supp:
                q_alert = f"⚠️ This answer uses a user-approved AI suggestion for missing data — original document did not contain this information directly (Derived from: {supp_source or 'corpus evidence'})."
                if q_alert not in quality_caveats:
                    quality_caveats.append(q_alert)
            elif q_status != "clean":
                q_alert = f"Note: Source document '{c.filename}' had data quality issues ({q_summary or 'missing/incomplete data'}) — treat with caution."
                if q_alert not in quality_caveats:
                    quality_caveats.append(q_alert)

            cited_chunks.append({
                "rank": rank,
                "filename": c.filename,
                "chunk_id": c.chunk_id,
                "chunk_index": c.chunk_index,
                "total_chunks": c.total_chunks,
                "similarity_score": score,
                "text": c.text,
                "file_type": c.file_type,
                "quality_status": q_status,
                "quality_summary": q_summary,
                "quality_issues": q_issues,
                "quality_alert": q_alert,
                "is_supplemented": is_supp,
                "supplement_source": supp_source
            })

        final_explanation = final_attempt.evaluation.explanation
        if quality_caveats:
            final_explanation += " " + " ".join(quality_caveats)

        return {
            "question": question,
            "final_answer": final_answer,
            "cycles_used": len(attempts),
            "passed": passed,
            "honesty_gate_triggered": honesty_gate_triggered,
            "groundedness_score": final_attempt.evaluation.groundedness_score,
            "relevance_score": final_attempt.evaluation.relevance_score,
            "evaluation_explanation": final_explanation,
            "claims_analysis": final_attempt.evaluation.claims_analysis,
            "cited_chunks": cited_chunks,
            "attempts": [a.to_dict() for a in attempts]
        }
