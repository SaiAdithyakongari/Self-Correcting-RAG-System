"""
Document ingestion module for the Self-Correcting RAG System.
Handles multi-format parsing (PDF, DOCX, XLSX, CSV, JSON, HTML, XML, Markdown, Code, etc.)
with robust binary-safe fallback extraction, intelligent chunking, and
automated Data Quality Detection.
"""

import os
import re
import json
import csv
import io
import uuid
from typing import List, Dict, Any, Tuple, Optional
from python_rag.quality import DataQualityDetector, DocumentQualityReport


class DocumentChunk:
    """Represents an extracted and chunked piece of text with metadata and quality signals."""
    def __init__(
        self,
        chunk_id: str,
        doc_id: str,
        filename: str,
        text: str,
        chunk_index: int,
        total_chunks: int,
        file_type: str,
        extraction_note: Optional[str] = None,
        quality_status: str = "clean",
        quality_summary: Optional[str] = None,
        quality_issues: Optional[List[Dict[str, Any]]] = None,
        is_supplemented: bool = False,
        supplement_source: Optional[str] = None,
        user_approved: bool = False,
        confidence: Optional[float] = None
    ):
        self.chunk_id = chunk_id
        self.doc_id = doc_id
        self.filename = filename
        self.text = text
        self.chunk_index = chunk_index
        self.total_chunks = total_chunks
        self.file_type = file_type
        self.extraction_note = extraction_note
        self.quality_status = quality_status
        self.quality_summary = quality_summary
        self.quality_issues = quality_issues or []
        self.is_supplemented = is_supplemented
        self.supplement_source = supplement_source
        self.user_approved = user_approved
        self.confidence = confidence

    def to_dict(self) -> Dict[str, Any]:
        return {
            "chunk_id": self.chunk_id,
            "doc_id": self.doc_id,
            "filename": self.filename,
            "text": self.text,
            "chunk_index": self.chunk_index,
            "total_chunks": self.total_chunks,
            "file_type": self.file_type,
            "extraction_note": self.extraction_note,
            "quality_status": self.quality_status,
            "quality_summary": self.quality_summary,
            "quality_issues": self.quality_issues,
            "is_supplemented": self.is_supplemented,
            "supplement_source": self.supplement_source,
            "user_approved": self.user_approved,
            "confidence": self.confidence
        }


class DocumentIngestionEngine:
    """Multi-format parser and chunker for document sets up to 1000 items."""

    CODE_EXTENSIONS = {
        ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp",
        ".h", ".cs", ".go", ".rs", ".rb", ".php", ".sh", ".sql", ".yaml", ".yml"
    }

    def __init__(self, chunk_size: int = 600, chunk_overlap: int = 100):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.quality_detector = DataQualityDetector()

    def extract_text(self, filename: str, content_bytes: bytes) -> Tuple[str, Optional[str]]:
        """
        Extract text from raw file bytes based on file extension.
        Returns: (extracted_text, extraction_note)
        """
        ext = os.path.splitext(filename)[1].lower()
        note = None

        try:
            if ext in [".txt", ".md", ".markdown"] or ext in self.CODE_EXTENSIONS:
                text = content_bytes.decode("utf-8", errors="replace")
                return text.strip(), None

            if ext == ".csv":
                text_stream = io.StringIO(content_bytes.decode("utf-8", errors="replace"))
                reader = csv.reader(text_stream)
                rows = []
                for row in reader:
                    rows.append(" | ".join(row))
                return "\n".join(rows).strip(), None

            if ext == ".json":
                parsed = json.loads(content_bytes.decode("utf-8", errors="replace"))
                return json.dumps(parsed, indent=2), None

            if ext in [".html", ".htm", ".xml"]:
                raw_str = content_bytes.decode("utf-8", errors="replace")
                clean_text = re.sub(r"<[^>]+>", " ", raw_str)
                clean_text = re.sub(r"\s+", " ", clean_text)
                return clean_text.strip(), None

            if ext == ".rtf":
                raw_str = content_bytes.decode("utf-8", errors="replace")
                clean_text = re.sub(r"\\[a-zA-Z0-9]+", "", raw_str)
                clean_text = re.sub(r"[{}]", "", clean_text)
                return clean_text.strip(), None

            # Fallback parser for binary or unhandled formats (PDF, DOCX, XLSX, etc.)
            printable_chars = []
            for b in content_bytes:
                if 32 <= b <= 126 or b in (10, 13, 9):
                    printable_chars.append(chr(b))
                else:
                    printable_chars.append(" ")
            raw_extracted = "".join(printable_chars)
            clean_text = re.sub(r"[ \t]+", " ", raw_extracted)
            clean_text = re.sub(r"\n\s*\n+", "\n\n", clean_text).strip()

            if len(clean_text) < 15:
                # Scanned image or binary with no meaningful text
                return "", "Document contains no extractable text — likely a scanned image without OCR."

            note = "processed with generic text extraction — formatting may not be fully preserved"
            return clean_text, note

        except Exception as err:
            return "", f"Extraction error: {str(err)}"

    def chunk_text(
        self,
        text: str,
        doc_id: str,
        filename: str,
        file_type: str,
        note: Optional[str],
        quality_status: str = "clean",
        quality_summary: Optional[str] = None,
        quality_issues: Optional[List[Dict[str, Any]]] = None
    ) -> List[DocumentChunk]:
        """Split text into overlapping chunks respecting sentence boundaries where possible."""
        if not text:
            return []

        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        if not paragraphs:
            paragraphs = [text]

        chunks_text: List[str] = []
        current_chunk = ""

        for para in paragraphs:
            if len(current_chunk) + len(para) + 2 <= self.chunk_size:
                if current_chunk:
                    current_chunk += "\n\n" + para
                else:
                    current_chunk = para
            else:
                if current_chunk:
                    chunks_text.append(current_chunk)
                if len(para) > self.chunk_size:
                    start = 0
                    while start < len(para):
                        end = start + self.chunk_size
                        slice_text = para[start:end]
                        chunks_text.append(slice_text)
                        start += (self.chunk_size - self.chunk_overlap)
                    current_chunk = ""
                else:
                    current_chunk = para

        if current_chunk:
            chunks_text.append(current_chunk)

        total_chunks = len(chunks_text)
        result: List[DocumentChunk] = []
        for idx, c_text in enumerate(chunks_text):
            chunk_id = f"{doc_id}_chk_{idx + 1}"
            result.append(
                DocumentChunk(
                    chunk_id=chunk_id,
                    doc_id=doc_id,
                    filename=filename,
                    text=c_text,
                    chunk_index=idx + 1,
                    total_chunks=total_chunks,
                    file_type=file_type,
                    extraction_note=note,
                    quality_status=quality_status,
                    quality_summary=quality_summary,
                    quality_issues=quality_issues
                )
            )

        return result

    def ingest_single_file(
        self,
        filename: str,
        content_bytes: bytes,
        doc_id: Optional[str] = None
    ) -> Tuple[List[DocumentChunk], Optional[str], DocumentQualityReport]:
        """
        Process a single file into chunks and run automatic Data Quality Detection.
        Returns: (chunks_list, note_or_warning, quality_report)
        """
        if not doc_id:
            doc_id = f"doc_{uuid.uuid4().hex[:8]}"

        ext = os.path.splitext(filename)[1].lower() or "unknown"
        extracted_text, note = self.extract_text(filename, content_bytes)

        # Automatic Data Quality Inspection runs immediately during ingestion
        quality_report = self.quality_detector.inspect_file(
            doc_id=doc_id,
            filename=filename,
            raw_bytes=content_bytes,
            extracted_text=extracted_text
        )

        quality_issues_dicts = [i.to_dict() for i in quality_report.issues]

        if not extracted_text:
            return [], note or quality_report.summary, quality_report

        chunks = self.chunk_text(
            text=extracted_text,
            doc_id=doc_id,
            filename=filename,
            file_type=ext,
            note=note,
            quality_status=quality_report.status,
            quality_summary=quality_report.summary,
            quality_issues=quality_issues_dicts
        )
        return chunks, note, quality_report
