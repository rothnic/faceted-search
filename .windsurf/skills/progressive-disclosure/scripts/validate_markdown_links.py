#!/usr/bin/env python3
"""
Markdown Link Validator

Validates all markdown links in files and directories.
Checks for broken internal links, missing anchors, and dead file references.

Usage:
    python validate_markdown_links.py file.md
    python validate_markdown_links.py directory/
    python validate_markdown_links.py --check-anchors file.md
    python validate_markdown_links.py --recursive directory/

Features:
- Validates internal file links (relative paths)
- Checks anchor links (#heading) in current and linked files
- Detects broken cross-references between markdown files
- Supports both inline links and reference-style links
- Recursive directory scanning
- Detailed error reporting with line numbers
"""

import argparse
import re
import sys
from pathlib import Path
from typing import List, Set, Dict, Tuple
from urllib.parse import unquote
from collections import defaultdict


class LinkError:
    def __init__(self, severity: str, message: str, file: Path, line: int = None):
        self.severity = severity  # "error", "warning", "info"
        self.message = message
        self.file = file
        self.line = line
    
    def __str__(self):
        severity_symbol = {
            "error": "❌",
            "warning": "⚠️",
            "info": "ℹ️"
        }
        symbol = severity_symbol.get(self.severity, "•")
        file_info = self.file.name
        line_info = f":{self.line}" if self.line else ""
        return f"{symbol} {severity_symbol} {file_info}{line_info}: {self.message}"
    
    def __repr__(self):
        return f"LinkError({self.severity}, {self.file.name}:{self.line}, {self.message})"


class MarkdownLinkValidator:
    def __init__(self, root_path: Path, check_anchors: bool = False, recursive: bool = True):
        self.root_path = root_path
        self.check_anchors = check_anchors
        self.recursive = recursive
        self.errors: List[LinkError] = []
        self.warnings: List[LinkError] = []
        self.info: List[LinkError] = []
        
        # Cache for file contents and anchors
        self.file_cache: Dict[Path, str] = {}
        self.anchor_cache: Dict[Path, Set[str]] = {}
    
    def add_error(self, message: str, file: Path, line: int = None):
        self.errors.append(LinkError("error", message, file, line))
    
    def add_warning(self, message: str, file: Path, line: int = None):
        self.warnings.append(LinkError("warning", message, file, line))
    
    def add_info(self, message: str, file: Path, line: int = None):
        self.info.append(LinkError("info", message, file, line))
    
    def validate(self) -> bool:
        """Run validation. Returns True if no errors."""
        if self.root_path.is_file():
            files = [self.root_path]
            base_dir = self.root_path.parent
        else:
            pattern = "**/*.md" if self.recursive else "*.md"
            files = list(self.root_path.glob(pattern))
            base_dir = self.root_path
        
        if not files:
            print(f"No markdown files found in {self.root_path}")
            return True
        
        print(f"Validating {len(files)} markdown file(s) in {base_dir}\n")
        
        # Pre-cache all files if checking anchors
        if self.check_anchors:
            for file in files:
                self._cache_file(file)
        
        # Validate each file
        for file in files:
            self._validate_file(file)
        
        # Report results
        self._print_results()
        
        return len(self.errors) == 0
    
    def _cache_file(self, file_path: Path):
        """Cache file content and extract anchors"""
        if file_path in self.file_cache:
            return
        
        try:
            content = file_path.read_text(encoding='utf-8')
            self.file_cache[file_path] = content
            self.anchor_cache[file_path] = self._extract_anchors(content)
        except Exception as e:
            self.add_warning(f"Failed to read file: {e}", file_path)
    
    def _extract_anchors(self, content: str) -> Set[str]:
        """Extract all heading anchors from markdown content"""
        anchors = set()
        
        # Match ATX headings (# Heading)
        for match in re.finditer(r'^#+\s+(.+)$', content, re.MULTILINE):
            heading_text = match.group(1)
            # Remove inline code, links, and formatting
            heading_text = re.sub(r'`[^`]+`', '', heading_text)
            heading_text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', heading_text)
            heading_text = re.sub(r'[*_~]', '', heading_text)
            
            # Convert to anchor format (lowercase, replace spaces with hyphens, remove special chars)
            anchor = heading_text.lower()
            anchor = re.sub(r'[^\w\s-]', '', anchor)
            anchor = re.sub(r'\s+', '-', anchor)
            anchor = re.sub(r'-+', '-', anchor)
            anchor = anchor.strip('-')
            
            if anchor:
                anchors.add(anchor)
        
        # Match Setext headings (underlined with = or -)
        for match in re.finditer(r'^(.+)\n[=-]+$', content, re.MULTILINE):
            heading_text = match.group(1)
            heading_text = re.sub(r'`[^`]+`', '', heading_text)
            heading_text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', heading_text)
            heading_text = re.sub(r'[*_~]', '', heading_text)
            
            anchor = heading_text.lower()
            anchor = re.sub(r'[^\w\s-]', '', anchor)
            anchor = re.sub(r'\s+', '-', anchor)
            anchor = re.sub(r'-+', '-', anchor)
            anchor = anchor.strip('-')
            
            if anchor:
                anchors.add(anchor)
        
        return anchors
    
    def _validate_file(self, file_path: Path):
        """Validate all links in a single markdown file"""
        try:
            content = file_path.read_text(encoding='utf-8')
        except Exception as e:
            self.add_error(f"Failed to read file: {e}", file_path)
            return
        
        lines = content.split('\n')
        
        # Find all links
        # Pattern matches: [text](url) and [text](url "title")
        inline_link_pattern = r'\[([^\]]+)\]\(([^\)]+)\)'
        
        # Pattern matches: [text][ref] and [ref][] and [text]
        # Then later: [ref]: url
        reference_link_pattern = r'\[([^\]]+)\]\[([^\]]*)\]'
        reference_def_pattern = r'^\[([^\]]+)\]:\s+(.+)$'
        
        # Build reference link map
        reference_links = {}
        for line_num, line in enumerate(lines, 1):
            for match in re.finditer(reference_def_pattern, line):
                ref_id = match.group(1).lower()
                url = match.group(2).strip()
                reference_links[ref_id] = url
        
        # Validate inline links
        for line_num, line in enumerate(lines, 1):
            # Check inline links
            for match in re.finditer(inline_link_pattern, line):
                link_text = match.group(1)
                link_url = match.group(2).strip()
                
                # Remove optional title
                link_url = re.sub(r'\s+"[^"]*"$', '', link_url)
                link_url = re.sub(r"\s+'[^']*'$", '', link_url)
                
                self._validate_link(link_url, file_path, line_num, link_text)
            
            # Check reference-style links
            for match in re.finditer(reference_link_pattern, line):
                link_text = match.group(1)
                ref_id = match.group(2) if match.group(2) else link_text
                ref_id = ref_id.lower()
                
                if ref_id in reference_links:
                    link_url = reference_links[ref_id]
                    self._validate_link(link_url, file_path, line_num, link_text)
                else:
                    self.add_error(f"Undefined reference link: [{ref_id}]", file_path, line_num)
    
    def _validate_link(self, link_url: str, source_file: Path, line_num: int, link_text: str):
        """Validate a single link"""
        
        # Skip external links (http://, https://, mailto:, etc.)
        if re.match(r'^[a-z]+:', link_url, re.IGNORECASE):
            return
        
        # Skip data URIs
        if link_url.startswith('data:'):
            return
        
        # Parse link into file path and anchor
        if '#' in link_url:
            file_part, anchor_part = link_url.split('#', 1)
            anchor_part = unquote(anchor_part)
        else:
            file_part = link_url
            anchor_part = None
        
        # Handle anchor-only links (same file)
        if not file_part:
            if anchor_part and self.check_anchors:
                if source_file not in self.anchor_cache:
                    self._cache_file(source_file)
                
                if anchor_part not in self.anchor_cache.get(source_file, set()):
                    self.add_error(f"Anchor not found: #{anchor_part}", source_file, line_num)
            return
        
        # Decode URL encoding
        file_part = unquote(file_part)
        
        # Resolve relative path
        if source_file.is_file():
            base_dir = source_file.parent
        else:
            base_dir = source_file
        
        target_path = (base_dir / file_part).resolve()
        
        # Check if file exists
        if not target_path.exists():
            self.add_error(f"Broken link: {link_url} -> {target_path} does not exist", source_file, line_num)
            return
        
        # Check if it's a file (not a directory)
        if target_path.is_dir():
            self.add_warning(f"Link points to directory (not file): {link_url}", source_file, line_num)
            return
        
        # Check anchor if present and anchor checking is enabled
        if anchor_part and self.check_anchors:
            if target_path not in self.anchor_cache:
                self._cache_file(target_path)
            
            available_anchors = self.anchor_cache.get(target_path, set())
            if anchor_part not in available_anchors:
                self.add_error(
                    f"Anchor not found: {link_url} -> #{anchor_part} not in {target_path.name}",
                    source_file,
                    line_num
                )
                if available_anchors:
                    similar = self._find_similar_anchor(anchor_part, available_anchors)
                    if similar:
                        self.add_info(f"  Did you mean: #{similar}?", source_file, line_num)
    
    def _find_similar_anchor(self, target: str, available: Set[str]) -> str:
        """Find most similar anchor using simple string matching"""
        target_lower = target.lower()
        
        # Exact match (case-insensitive)
        for anchor in available:
            if anchor.lower() == target_lower:
                return anchor
        
        # Substring match
        for anchor in available:
            if target_lower in anchor.lower() or anchor.lower() in target_lower:
                return anchor
        
        # Word overlap
        target_words = set(target_lower.split('-'))
        best_match = None
        best_score = 0
        
        for anchor in available:
            anchor_words = set(anchor.lower().split('-'))
            overlap = len(target_words & anchor_words)
            if overlap > best_score:
                best_score = overlap
                best_match = anchor
        
        return best_match if best_score > 0 else None
    
    def _print_results(self):
        """Print validation results"""
        all_issues = self.errors + self.warnings + self.info
        
        if not all_issues:
            print("✅ All links valid! No issues found.\n")
            return
        
        # Group issues by file
        issues_by_file = defaultdict(list)
        for issue in all_issues:
            issues_by_file[issue.file].append(issue)
        
        # Print issues grouped by file
        for file_path in sorted(issues_by_file.keys()):
            print(f"\n{file_path}:")
            for issue in sorted(issues_by_file[file_path], key=lambda x: (x.line or 0)):
                line_str = f"  Line {issue.line}: " if issue.line else "  "
                severity_symbol = {"error": "❌", "warning": "⚠️", "info": "ℹ️"}.get(issue.severity, "•")
                print(f"{line_str}{severity_symbol} {issue.message}")
        
        # Summary
        print(f"\n{'='*60}")
        print(f"Summary:")
        print(f"  Errors:   {len(self.errors)}")
        print(f"  Warnings: {len(self.warnings)}")
        print(f"  Info:     {len(self.info)}")
        print(f"{'='*60}\n")
        
        if self.errors:
            print("❌ Validation failed with errors")
        elif self.warnings:
            print("⚠️  Validation passed with warnings")
        else:
            print("✅ Validation passed")


def main():
    parser = argparse.ArgumentParser(
        description="Validate markdown links in files and directories",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Validate single file
  python validate_markdown_links.py README.md
  
  # Validate all markdown files in directory (non-recursive)
  python validate_markdown_links.py docs/ --no-recursive
  
  # Validate with anchor checking
  python validate_markdown_links.py docs/ --check-anchors
  
  # Validate recursively with full checking
  python validate_markdown_links.py . --recursive --check-anchors
        """
    )
    
    parser.add_argument(
        'path',
        type=Path,
        help='Path to markdown file or directory'
    )
    
    parser.add_argument(
        '--check-anchors',
        action='store_true',
        help='Check if anchor links (#heading) are valid'
    )
    
    parser.add_argument(
        '--recursive',
        action='store_true',
        default=True,
        help='Recursively scan directories (default: True)'
    )
    
    parser.add_argument(
        '--no-recursive',
        dest='recursive',
        action='store_false',
        help='Do not recursively scan directories'
    )
    
    args = parser.parse_args()
    
    if not args.path.exists():
        print(f"Error: Path does not exist: {args.path}")
        sys.exit(1)
    
    validator = MarkdownLinkValidator(
        args.path,
        check_anchors=args.check_anchors,
        recursive=args.recursive
    )
    
    success = validator.validate()
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
