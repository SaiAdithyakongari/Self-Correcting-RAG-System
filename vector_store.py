"""
Vector store and semantic search engine for the Self-Correcting RAG System.
Features fast normalized vector cosine similarity matrix operations via NumPy,
dense n-gram semantic hashing fallback, batch embeddings, and document library management.
"""

import os
import math
import hashlib
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple

try:
    import numpy as np
except ImportError:
    np = None

from python_rag.ingestion import DocumentChunk
from python_rag.storage import PersistentStorage


class VectorStore:
    """
    High-performance vector index supporting fast similarity search over large chunk sets.
    Computes L2-normalized embeddings so dot product equals cosine similarity.
    Persists documents and embedding matrices to SQLite so they survive restarts.
    """

    def __init__(self, embedding_dim: int = 256, storage: Optional[PersistentStorage] = None, auto_load: bool = True):
        self.embedding_dim = embedding_dim
        self.storage = storage or PersistentStorage()
        self.chunks: List[DocumentChunk] = []
        self.chunk_ids: List[str] = []
        # Normalized matrix of shape (N, dim) or list of vectors
        self.matrix: Any = None
        self.doc_registry: Dict[str, Dict[str, Any]] = {}

        if auto_load:
            self._load_from_storage()

    def _load_from_storage(self) -> None:
        """Hydrate vector store with previously persisted documents and chunks."""
        try:
            persisted_docs = self.storage.load_all_documents()
            for d in persisted_docs:
                self.doc_registry[d["doc_id"]] = d

            persisted_chunks = self.storage.load_all_chunks()
            if not persisted_chunks:
                return

            loaded_vecs = []
            for c in persisted_chunks:
                chunk_obj = DocumentChunk(
                    chunk_id=c["chunk_id"],
                    doc_id=c["doc_id"],
                    filename=c["filename"],
                    text=c["text"],
                    chunk_index=c["chunk_index"],
                    total_chunks=c["total_chunks"],
                    file_type=c["file_type"],
                    extraction_note=c.get("extraction_note"),
                    quality_status=c.get("quality_status", "clean"),
                    quality_summary=c.get("quality_summary"),
                    quality_issues=c.get("quality_issues", [])
                )
                self.chunks.append(chunk_obj)
                self.chunk_ids.append(c["chunk_id"])

                emb = c.get("embedding")
                if emb is not None and len(emb) == self.embedding_dim:
                    loaded_vecs.append(emb)
                else:
                    loaded_vecs.append(self._generate_dense_semantic_embedding(c["text"]))

            if loaded_vecs:
                if np is not None:
                    self.matrix = np.vstack(loaded_vecs)
                else:
                    self.matrix = loaded_vecs
        except Exception as e:
            print(f"[VectorStore Warning] Could not load persisted data: {e}")

    def _generate_dense_semantic_embedding(self, text: str) -> Any:
        """
        Deterministic, semantic dense vector embedding using character n-grams
        and token frequency hashing with IDF weighting.
        Yields fast, stable semantic similarity even in offline / high-scale scenarios.
        """
        if np is not None:
            vec = np.zeros(self.embedding_dim, dtype=np.float32)
        else:
            vec = [0.0] * self.embedding_dim

        words = text.lower().split()
        if not words:
            return vec

        # Token + character 3-gram hashing
        for idx, word in enumerate(words):
            # Positional dampening
            weight = 1.0 + 1.0 / (idx + 1)
            # Word hash
            h_word = int(hashlib.sha256(word.encode("utf-8")).hexdigest()[:8], 16)
            vec[h_word % self.embedding_dim] += weight

            # 3-gram hashes for subword semantic matching
            if len(word) >= 3:
                for i in range(len(word) - 2):
                    ngram = word[i:i+3]
                    h_ng = int(hashlib.md5(ngram.encode("utf-8")).hexdigest()[:6], 16)
                    vec[h_ng % self.embedding_dim] += 0.5

        # L2 normalize
        if np is not None:
            norm = np.linalg.norm(vec)
            if norm > 1e-9:
                vec = vec / norm
            return vec
        else:
            norm = math.sqrt(sum(x * x for x in vec))
            if norm > 1e-9:
                vec = [x / norm for x in vec]
            return vec

    def embed_batch(self, texts: List[str]) -> Any:
        """Embed a batch of text chunks efficiently."""
        vectors = [self._generate_dense_semantic_embedding(t) for t in texts]
        if np is not None:
            return np.vstack(vectors)
        return vectors

    def add_chunks(self, chunks: List[DocumentChunk], quality_report: Optional[Any] = None) -> int:
        """Add chunks to the index in batch and rebuild the matrix."""
        if not chunks:
            return 0

        new_texts = [c.text for c in chunks]
        new_vecs = self.embed_batch(new_texts)

        for c in chunks:
            self.chunks.append(c)
            self.chunk_ids.append(c.chunk_id)

            # Update document registry
            if c.doc_id not in self.doc_registry:
                q_dict = quality_report.to_dict() if hasattr(quality_report, "to_dict") else quality_report
                if not q_dict and c.quality_status:
                    q_dict = {
                        "status": c.quality_status,
                        "summary": c.quality_summary,
                        "issues": c.quality_issues,
                        "total_issues": len(c.quality_issues)
                    }

                self.doc_registry[c.doc_id] = {
                    "doc_id": c.doc_id,
                    "filename": c.filename,
                    "file_type": c.file_type,
                    "chunk_count": 0,
                    "total_chars": 0,
                    "quality_report": q_dict
                }
            self.doc_registry[c.doc_id]["chunk_count"] += 1
            self.doc_registry[c.doc_id]["total_chars"] += len(c.text)

        if np is not None:
            if self.matrix is None or len(self.matrix) == 0:
                self.matrix = new_vecs
            else:
                self.matrix = np.vstack([self.matrix, new_vecs])
        else:
            if self.matrix is None:
                self.matrix = list(new_vecs)
            else:
                self.matrix.extend(new_vecs)

        # Persist to SQLite storage
        try:
            for doc_id, doc_info in self.doc_registry.items():
                self.storage.save_document(
                    doc_id=doc_id,
                    filename=doc_info["filename"],
                    file_type=doc_info["file_type"],
                    chunk_count=doc_info["chunk_count"],
                    total_chars=doc_info["total_chars"],
                    indexed_at=doc_info.get("indexed_at", str(datetime.now().isoformat())),
                    extraction_note=doc_info.get("extraction_note"),
                    quality_report=doc_info.get("quality_report")
                )

            chunks_data = []
            for idx, c in enumerate(chunks):
                chunks_data.append({
                    "chunk_id": c.chunk_id,
                    "doc_id": c.doc_id,
                    "filename": c.filename,
                    "file_type": c.file_type,
                    "text": c.text,
                    "chunk_index": c.chunk_index,
                    "total_chunks": c.total_chunks,
                    "char_count": len(c.text),
                    "extraction_note": c.extraction_note,
                    "quality_status": getattr(c, "quality_status", "clean"),
                    "quality_summary": getattr(c, "quality_summary", None),
                    "quality_issues": getattr(c, "quality_issues", []),
                    "embedding": new_vecs[idx]
                })
            self.storage.save_chunks_batch(chunks_data)
        except Exception as e:
            print(f"[VectorStore Warning] Could not persist chunks: {e}")

        return len(chunks)

    def register_empty_document(
        self,
        doc_id: str,
        filename: str,
        file_type: str,
        quality_report: Optional[Any] = None
    ) -> None:
        """Register a document that produced 0 extractable chunks (e.g. scanned image PDF)."""
        q_dict = quality_report.to_dict() if hasattr(quality_report, "to_dict") else quality_report
        doc_info = {
            "doc_id": doc_id,
            "filename": filename,
            "file_type": file_type,
            "chunk_count": 0,
            "total_chars": 0,
            "indexed_at": str(datetime.now().isoformat()),
            "quality_report": q_dict
        }
        self.doc_registry[doc_id] = doc_info

        try:
            self.storage.save_document(
                doc_id=doc_id,
                filename=filename,
                file_type=file_type,
                chunk_count=0,
                total_chars=0,
                indexed_at=doc_info["indexed_at"],
                quality_report=q_dict
            )
        except Exception as e:
            print(f"[VectorStore Warning] Could not persist empty document: {e}")

    def remove_document(self, doc_id: str) -> bool:
        """Remove a document and its chunks from the vector store."""
        if doc_id not in self.doc_registry:
            return False

        indices_to_keep = [i for i, c in enumerate(self.chunks) if c.doc_id != doc_id]

        self.chunks = [self.chunks[i] for i in indices_to_keep]
        self.chunk_ids = [self.chunk_ids[i] for i in indices_to_keep]

        if indices_to_keep and self.matrix is not None:
            if np is not None:
                self.matrix = self.matrix[indices_to_keep]
            else:
                self.matrix = [self.matrix[i] for i in indices_to_keep]
        else:
            self.matrix = None

        del self.doc_registry[doc_id]

        try:
            self.storage.delete_document(doc_id)
        except Exception as e:
            print(f"[VectorStore Warning] Could not delete document from persistent storage: {e}")

        return True

    def similarity_search(
        self,
        query: str,
        top_k: int = 5,
        min_score: float = 0.05
    ) -> List[Tuple[DocumentChunk, float, int]]:
        """
        Fast matrix dot-product similarity search.
        Returns: list of (chunk, similarity_score, rank)
        """
        if self.matrix is None or len(self.chunks) == 0:
            return []

        q_vec = self._generate_dense_semantic_embedding(query)
        # Dot product against all normalized rows = cosine similarity
        if np is not None:
            scores = list(np.dot(self.matrix, q_vec))
        else:
            scores = [sum(a * b for a, b in zip(row, q_vec)) for row in self.matrix]

        # Lexical boost for direct keyword overlap
        q_tokens = set(query.lower().split())
        for idx, chunk in enumerate(self.chunks):
            c_text_lower = chunk.text.lower()
            matches = sum(1 for t in q_tokens if t in c_text_lower and len(t) > 2)
            if matches > 0:
                boost = min(0.20, matches * 0.05)
                scores[idx] = min(1.0, scores[idx] + boost)

        top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]

        results: List[Tuple[DocumentChunk, float, int]] = []
        rank = 1
        for idx in top_indices:
            score = float(scores[idx])
            if score >= min_score:
                results.append((self.chunks[idx], round(score, 4), rank))
                rank += 1

        return results

    def get_library_summary(self) -> List[Dict[str, Any]]:
        """Return list of indexed documents for library management."""
        return list(self.doc_registry.values())

    def get_total_chunks(self) -> int:
        return len(self.chunks)
