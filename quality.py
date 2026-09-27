"""
Data Quality Detection module for the Self-Correcting RAG System.
Automatically inspects structured and unstructured files during ingestion for:
- Missing/null/empty values in fields and columns (CSV, XLSX, JSON)
- Entirely empty columns
- Structural gaps: empty sections, headings with no body content
- Empty pages / zero-extractable text (e.g., scanned image PDFs without OCR)
- Truncated or cut-off text ending mid-sentence/mid-word
Produces granular, actionable reports with file and location specificity.
"""

import os
import re
import csv
import json
import io
from typing import List, Dict, Any, Optional


class QualityIssue:
    def __init__(
        self,
        issue_id: str,
        category: str,
        severity: str,  # 'minor' or 'critical'
        location: str,
        description: str,
        affected_ratio: Optional[float] = None
    ):
        self.issue_id = issue_id
        self.category = category
        self.severity = severity
        self.location = location
        self.description = description
        self.affected_ratio = affected_ratio

    def to_dict(self) -> Dict[str, Any]:
        return {
            "issue_id": self.issue_id,
            "category": self.category,
            "severity": self.severity,
            "location": self.location,
            "description": self.description,
            "affected_ratio": self.affected_ratio
        }


class DocumentQualityReport:
    def __init__(
        self,
        doc_id: str,
        filename: str,
        file_type: str,
        status: str,  # 'clean', 'minor', 'critical'
        total_issues: int,
        critical_issues: int,
        minor_issues: int,
        issues: List[QualityIssue],
        summary: str,
        checked_at: str
    ):
        self.doc_id = doc_id
        self.filename = filename
        self.file_type = file_type
        self.status = status
        self.total_issues = total_issues
        self.critical_issues = critical_issues
        self.minor_issues = minor_issues
        self.issues = issues
        self.summary = summary
        self.checked_at = checked_at

    def to_dict(self) -> Dict[str, Any]:
        return {
            "doc_id": self.doc_id,
            "filename": self.filename,
            "file_type": self.file_type,
            "status": self.status,
            "total_issues": self.total_issues,
            "critical_issues": self.critical_issues,
            "minor_issues": self.minor_issues,
            "issues": [i.to_dict() for i in self.issues],
            "summary": self.summary,
            "checked_at": self.checked_at
        }


class DataQualityDetector:
    """
    Automated data quality inspector for multi-format document ingestion.
    """

    NULL_LITERALS = {
        "", "null", "none", "nan", "n/a", "na", "undefined",
        "#n/a", "#null!", "nil", "missing", "unknown"
    }

    def inspect_file(
        self,
        doc_id: str,
        filename: str,
        raw_bytes: bytes,
        extracted_text: str
    ) -> DocumentQualityReport:
        ext = os.path.splitext(filename)[1].lower()
        import datetime
        now_str = datetime.datetime.now().strftime("%H:%M:%S")

        issues: List[QualityIssue] = []

        # 1. Check for complete lack of extractable content
        clean_text = (extracted_text or "").strip()
        if len(clean_text) == 0:
            is_pdf = ext == ".pdf"
            desc = (
                f"Document '{filename}' contains no extractable text — "
                f"{'likely a scanned image-based PDF without OCR' if is_pdf else 'file is completely empty'}."
            )
            issues.append(
                QualityIssue(
                    issue_id=f"{doc_id}_q1",
                    category="no_extractable_text",
                    severity="critical",
                    location="Whole document",
                    description=desc,
                    affected_ratio=1.0
                )
            )
            return DocumentQualityReport(
                doc_id=doc_id,
                filename=filename,
                file_type=ext or "unknown",
                status="critical",
                total_issues=1,
                critical_issues=1,
                minor_issues=0,
                issues=issues,
                summary=f"Critical: {desc}",
                checked_at=now_str
            )

        # 2. Structured format inspection (CSV, JSON, XLSX-like tables)
        if ext == ".csv":
            issues.extend(self._inspect_csv(doc_id, filename, raw_bytes))
        elif ext == ".json":
            issues.extend(self._inspect_json(doc_id, filename, raw_bytes))
        else:
            # Unstructured text inspection (PDF, DOCX, TXT, MD, HTML, code)
            issues.extend(self._inspect_unstructured(doc_id, filename, clean_text, raw_bytes, ext))

        # Determine overall severity
        critical_count = sum(1 for i in issues if i.severity == "critical")
        minor_count = sum(1 for i in issues if i.severity == "minor")
        total = len(issues)

        if critical_count > 0:
            status = "critical"
        elif minor_count > 0:
            status = "minor"
        else:
            status = "clean"

        if total == 0:
            summary = "Data quality check passed cleanly (100% complete, no gaps or nulls detected)."
        else:
            items_str = ", ".join([i.location for i in issues[:3]])
            if total > 3:
                items_str += f" (+{total - 3} more)"
            summary = f"{total} issue(s) detected ({critical_count} critical, {minor_count} minor) across {items_str}."

        return DocumentQualityReport(
            doc_id=doc_id,
            filename=filename,
            file_type=ext or "unknown",
            status=status,
            total_issues=total,
            critical_issues=critical_count,
            minor_issues=minor_count,
            issues=issues,
            summary=summary,
            checked_at=now_str
        )

    def _inspect_csv(self, doc_id: str, filename: str, raw_bytes: bytes) -> List[QualityIssue]:
        issues: List[QualityIssue] = []
        try:
            text = raw_bytes.decode("utf-8", errors="replace")
            reader = list(csv.reader(io.StringIO(text)))
            if not reader:
                issues.append(QualityIssue(
                    issue_id=f"{doc_id}_csv_empty",
                    category="no_extractable_text",
                    severity="critical",
                    location="Whole CSV",
                    description=f"CSV file '{filename}' contains no rows or data.",
                    affected_ratio=1.0
                ))
                return issues

            headers = [h.strip() for h in reader[0]]
            data_rows = reader[1:]
            total_rows = len(data_rows)

            if total_rows == 0:
                issues.append(QualityIssue(
                    issue_id=f"{doc_id}_csv_no_data",
                    category="empty_section",
                    severity="minor",
                    location="Data table",
                    description=f"CSV file '{filename}' contains headers but 0 data rows.",
                    affected_ratio=1.0
                ))
                return issues

            # Check each column
            num_cols = len(headers)
            for c_idx in range(num_cols):
                col_name = headers[c_idx] if headers[c_idx] else f"Column {c_idx + 1}"
                empty_count = 0

                for r in data_rows:
                    val = r[c_idx].strip() if c_idx < len(r) else ""
                    if val.lower() in self.NULL_LITERALS:
                        empty_count += 1

                ratio = empty_count / total_rows

                if empty_count == total_rows:
                    # 100% empty column
                    issues.append(QualityIssue(
                        issue_id=f"{doc_id}_col_{c_idx}_all_empty",
                        category="empty_column",
                        severity="critical" if num_cols <= 2 else "minor",
                        location=f"Column '{col_name}'",
                        description=f"Column '{col_name}' in '{filename}' is entirely empty across all {total_rows} rows (100%).",
                        affected_ratio=1.0
                    ))
                elif empty_count > 0:
                    pct = round(ratio * 100, 1)
                    issues.append(QualityIssue(
                        issue_id=f"{doc_id}_col_{c_idx}_missing",
                        category="missing_values",
                        severity="minor" if pct < 50 else "critical",
                        location=f"Column '{col_name}'",
                        description=f"Column '{col_name}' in '{filename}' is missing in {empty_count} of {total_rows} rows ({pct}%).",
                        affected_ratio=ratio
                    ))
        except Exception as e:
            issues.append(QualityIssue(
                issue_id=f"{doc_id}_csv_err",
                category="truncated_text",
                severity="minor",
                location="CSV Parser",
                description=f"CSV structure parse warning in '{filename}': {str(e)}"
            ))

        return issues

    def _inspect_json(self, doc_id: str, filename: str, raw_bytes: bytes) -> List[QualityIssue]:
        issues: List[QualityIssue] = []
        try:
            data = json.loads(raw_bytes.decode("utf-8", errors="replace"))
            if isinstance(data, list):
                total_records = len(data)
                if total_records == 0:
                    issues.append(QualityIssue(
                        issue_id=f"{doc_id}_json_empty",
                        category="empty_section",
                        severity="minor",
                        location="Root Array",
                        description=f"JSON array in '{filename}' is empty ([])."
                    ))
                    return issues

                # Gather all keys from dict items
                dict_items = [d for d in data if isinstance(d, dict)]
                if dict_items:
                    all_keys = set()
                    for d in dict_items:
                        all_keys.update(d.keys())

                    for key in sorted(all_keys):
                        missing_count = 0
                        for d in dict_items:
                            if key not in d:
                                missing_count += 1
                            else:
                                v = d[key]
                                if v is None or (isinstance(v, str) and v.strip().lower() in self.NULL_LITERALS):
                                    missing_count += 1

                        ratio = missing_count / len(dict_items)
                        if missing_count == len(dict_items):
                            issues.append(QualityIssue(
                                issue_id=f"{doc_id}_json_{key}_all",
                                category="empty_column",
                                severity="minor",
                                location=f"Field '{key}'",
                                description=f"Field '{key}' in '{filename}' is entirely null/empty across all {len(dict_items)} records (100%).",
                                affected_ratio=1.0
                            ))
                        elif missing_count > 0:
                            pct = round(ratio * 100, 1)
                            issues.append(QualityIssue(
                                issue_id=f"{doc_id}_json_{key}_part",
                                category="missing_values",
                                severity="minor",
                                location=f"Field '{key}'",
                                description=f"Field '{key}' in '{filename}' is missing/null in {missing_count} of {len(dict_items)} records ({pct}%).",
                                affected_ratio=ratio
                            ))
            elif isinstance(data, dict):
                for k, v in data.items():
                    if v is None or (isinstance(v, str) and v.strip().lower() in self.NULL_LITERALS) or v == [] or v == {}:
                        issues.append(QualityIssue(
                            issue_id=f"{doc_id}_json_obj_{k}",
                            category="missing_values",
                            severity="minor",
                            location=f"Field '{k}'",
                            description=f"Field '{k}' in '{filename}' has a null or empty value."
                        ))
        except Exception as e:
            issues.append(QualityIssue(
                issue_id=f"{doc_id}_json_err",
                category="truncated_text",
                severity="minor",
                location="JSON syntax",
                description=f"JSON parsing anomaly in '{filename}': {str(e)}"
            ))

        return issues

    def _inspect_unstructured(
        self,
        doc_id: str,
        filename: str,
        text: str,
        raw_bytes: bytes,
        ext: str
    ) -> List[QualityIssue]:
        issues: List[QualityIssue] = []

        # 1. Scanned Image PDF / Bare minimal text detection
        if len(text) < 30 and ext in (".pdf", ".docx", ".pptx", ".odt"):
            issues.append(QualityIssue(
                issue_id=f"{doc_id}_scanned",
                category="no_extractable_text",
                severity="critical",
                location=f"Page 1 of '{filename}'",
                description=f"Document '{filename}' contains under 30 extractable characters — likely a scanned image without OCR.",
                affected_ratio=1.0
            ))
            return issues

        # 2. Empty page detection (checking form feed \f or [Page X] or page splits)
        if "\f" in text or "[Page " in text:
            pages = re.split(r"\f|(?=\[Page \d+\])", text)
            for p_idx, page_content in enumerate(pages):
                clean_page = page_content.strip()
                if len(clean_page) < 15 and len(clean_page) >= 0:
                    page_num = p_idx + 1
                    issues.append(QualityIssue(
                        issue_id=f"{doc_id}_page_{page_num}_empty",
                        category="empty_page",
                        severity="minor",
                        location=f"Page {page_num} of '{filename}'",
                        description=f"Page {page_num} of '{filename}' contains no extractable text — likely a blank page or scanned image without OCR."
                    ))

        # 3. Structural gaps: Empty sections / Headings with no body content beneath them
        lines = [line.strip() for line in text.split("\n")]
        heading_pattern = re.compile(
            r"^(?:#{1,6}\s+(.+)|(?:\d+\.?\s+([A-Z][A-Za-z0-9\s,\-\(\)]{3,}))|(?:SECTION\s+[A-Z0-9\.\:]+\s*(.*)))$",
            re.IGNORECASE
        )

        for idx, line in enumerate(lines):
            match = heading_pattern.match(line)
            if match:
                heading_title = (match.group(1) or match.group(2) or match.group(3) or line).strip()
                # Check next 3 non-empty lines
                has_content = False
                for next_idx in range(idx + 1, min(len(lines), idx + 5)):
                    next_line = lines[next_idx]
                    if not next_line:
                        continue
                    # If the next non-empty line is another heading, this section is empty!
                    if heading_pattern.match(next_line):
                        break
                    if len(next_line) > 10:
                        has_content = True
                        break

                if not has_content and idx == len(lines) - 1:
                    # Heading at the very end of file
                    issues.append(QualityIssue(
                        issue_id=f"{doc_id}_sec_empty_{idx}",
                        category="empty_section",
                        severity="minor",
                        location=f"Section '{heading_title}'",
                        description=f"Section '{heading_title}' in '{filename}' has a heading but no body content detected."
                    ))
                elif not has_content:
                    # Check if followed immediately by another heading
                    next_non_empty = next((l for l in lines[idx+1:] if l), None)
                    if next_non_empty and heading_pattern.match(next_non_empty):
                        issues.append(QualityIssue(
                            issue_id=f"{doc_id}_sec_empty_{idx}",
                            category="empty_section",
                            severity="minor",
                            location=f"Section '{heading_title}'",
                            description=f"Section '{heading_title}' in '{filename}' has a heading but no body content detected."
                        ))

        # 4. Truncated or cut-off text ending mid-sentence/mid-word
        # Look at the end of the text
        clean_text_tail = text.rstrip()
        if len(clean_text_tail) > 40:
            last_char = clean_text_tail[-1]
            valid_endings = {'.', '!', '?', '"', "'", ')', ']', '}', '`', ';', ':', '—'}
            last_words = clean_text_tail.split()[-4:]
            tail_phrase = " ".join(last_words)

            dangling_words = {"the", "and", "or", "to", "with", "from", "shall", "will", "is", "are", "that", "of", "a", "an"}
            last_token = last_words[-1].lower().strip(" ,;:")

            is_truncated = False
            trunc_reason = ""

            if last_char not in valid_endings:
                if last_char == '-' or last_token in dangling_words or len(last_token) <= 2:
                    is_truncated = True
                    trunc_reason = f"ends abruptly on dangling word '{last_token}'"
                elif not re.match(r"[A-Za-z0-9]", last_char):
                    is_truncated = False
                else:
                    is_truncated = True
                    trunc_reason = "missing terminal punctuation"

            if is_truncated:
                issues.append(QualityIssue(
                    issue_id=f"{doc_id}_trunc",
                    category="truncated_text",
                    severity="minor",
                    location=f"End of document '{filename}'",
                    description=f"Text in '{filename}' appears truncated or cut off abruptly at '...{tail_phrase}' ({trunc_reason})."
                ))

        return issues
