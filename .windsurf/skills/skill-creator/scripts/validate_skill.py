#!/usr/bin/env python3
"""
Skill Validator

Validates SKILL.md files for structure, content, and best practices.
Checks frontmatter, line counts, references, and common anti-patterns.

Usage:
    python validate_skill.py path/to/SKILL.md
    python validate_skill.py path/to/skill/  # Auto-finds SKILL.md
"""

import argparse
import re
import sys
from pathlib import Path
from typing import List, Tuple

class ValidationError:
    def __init__(self, severity: str, message: str, line: int = None):
        self.severity = severity  # "error", "warning", "info"
        self.message = message
        self.line = line
    
    def __str__(self):
        severity_symbol = {
            "error": "❌",
            "warning": "⚠️",
            "info": "ℹ️"
        }
        symbol = severity_symbol.get(self.severity, "•")
        line_info = f" (line {self.line})" if self.line else ""
        return f"{symbol} {self.severity.upper()}{line_info}: {self.message}"

class SkillValidator:
    def __init__(self, skill_path: Path):
        self.skill_path = skill_path
        self.skill_dir = skill_path.parent
        self.errors: List[ValidationError] = []
        self.warnings: List[ValidationError] = []
        self.info: List[ValidationError] = []
        
    def add_error(self, message: str, line: int = None):
        self.errors.append(ValidationError("error", message, line))
    
    def add_warning(self, message: str, line: int = None):
        self.warnings.append(ValidationError("warning", message, line))
    
    def add_info(self, message: str, line: int = None):
        self.info.append(ValidationError("info", message, line))
    
    def validate(self) -> bool:
        """Run all validations. Returns True if no errors."""
        print(f"Validating skill: {self.skill_path}\n")
        
        # Read file
        try:
            content = self.skill_path.read_text(encoding='utf-8')
        except Exception as e:
            self.add_error(f"Failed to read file: {e}")
            return False
        
        lines = content.split('\n')
        
        # Run validations
        self.validate_frontmatter(content, lines)
        self.validate_structure(lines)
        self.validate_references(content, lines)
        self.validate_scripts(lines)
        self.validate_content_quality(content, lines)
        self.validate_anti_patterns(content, lines)
        
        # Report results
        self.print_results()
        
        return len(self.errors) == 0
    
    def validate_frontmatter(self, content: str, lines: List[str]):
        """Validate YAML frontmatter"""
        if not content.startswith('---'):
            self.add_error("Missing frontmatter (must start with ---)")
            return
        
        # Extract frontmatter
        try:
            end_idx = content.index('---', 3)
            frontmatter = content[3:end_idx]
        except ValueError:
            self.add_error("Malformed frontmatter (missing closing ---)")
            return
        
        # Check for required fields
        if 'name:' not in frontmatter:
            self.add_error("Missing required field: name")
        else:
            # Validate name format
            name_match = re.search(r'name:\s*(.+)', frontmatter)
            if name_match:
                name = name_match.group(1).strip()
                if len(name) > 64:
                    self.add_error(f"Skill name too long ({len(name)} chars, max 64)")
                if not re.match(r'^[a-z0-9]+(-[a-z0-9]+)*$', name):
                    self.add_error(f"Invalid name format: '{name}' (must be lowercase, alphanumeric, hyphens only)")
                
                # Check if name matches directory name
                expected_name = self.skill_dir.name
                if name != expected_name:
                    self.add_warning(f"Name '{name}' doesn't match directory name '{expected_name}'")
        
        if 'description:' not in frontmatter:
            self.add_error("Missing required field: description")
        else:
            # Validate description
            desc_match = re.search(r'description:\s*(.+?)(?=\n[a-z]+:|$)', frontmatter, re.DOTALL)
            if desc_match:
                description = desc_match.group(1).strip()
                if len(description) > 1024:
                    self.add_error(f"Description too long ({len(description)} chars, max 1024)")
                if len(description) < 20:
                    self.add_warning("Description is very short (should include what and when)")
                if "TODO" in description.upper():
                    self.add_error("Description contains TODO placeholder")
                
                # Check for good description practices
                if "when" not in description.lower() and "use" not in description.lower():
                    self.add_warning("Description should include when to use this skill")
    
    def validate_structure(self, lines: List[str]):
        """Validate overall structure and line count"""
        total_lines = len(lines)
        
        # Count non-frontmatter lines
        body_start = 0
        for i, line in enumerate(lines):
            if i > 0 and line.strip() == '---':
                body_start = i + 1
                break
        
        body_lines = total_lines - body_start
        
        if body_lines > 500:
            self.add_warning(f"SKILL.md body is {body_lines} lines (recommended <500). Consider moving content to reference files.")
        elif body_lines > 800:
            self.add_error(f"SKILL.md body is {body_lines} lines (strongly recommended <500). Move content to reference files.")
        
        # Check for basic sections
        content_lower = '\n'.join(lines).lower()
        
        if '## when to use' not in content_lower:
            self.add_warning("Missing 'When to Use' section (helps with skill discovery)")
        
        # Check for TODO placeholders
        todo_count = sum(1 for line in lines if 'TODO' in line.upper())
        if todo_count > 0:
            self.add_warning(f"Found {todo_count} TODO placeholder(s) - complete before using")
    
    def validate_references(self, content: str, lines: List[str]):
        """Validate reference file structure and links"""
        reference_dir = self.skill_dir / "reference"
        
        # Find reference mentions in SKILL.md
        ref_pattern = r'reference/([a-zA-Z0-9_-]+\.md)'
        referenced_files = set(re.findall(ref_pattern, content))
        
        if referenced_files:
            if not reference_dir.exists():
                self.add_error(f"References mentioned but reference/ directory doesn't exist")
            else:
                # Check if referenced files exist
                for ref_file in referenced_files:
                    ref_path = reference_dir / ref_file
                    if not ref_path.exists():
                        self.add_warning(f"Referenced file doesn't exist: reference/{ref_file}")
        
        # Check for nested references (anti-pattern)
        if reference_dir.exists():
            for ref_file in reference_dir.glob("*.md"):
                try:
                    ref_content = ref_file.read_text(encoding='utf-8')
                    nested_refs = re.findall(ref_pattern, ref_content)
                    if nested_refs:
                        self.add_warning(f"{ref_file.name} references other reference files (anti-pattern: keep references one level deep)")
                except Exception:
                    pass
    
    def validate_scripts(self, lines: List[str]):
        """Validate script references and structure"""
        scripts_dir = self.skill_dir / "scripts"
        
        # Find script mentions
        script_pattern = r'scripts/([a-zA-Z0-9_-]+\.(?:py|sh|js|ts))'
        content = '\n'.join(lines)
        referenced_scripts = set(re.findall(script_pattern, content))
        
        if referenced_scripts:
            if not scripts_dir.exists():
                self.add_error("Scripts mentioned but scripts/ directory doesn't exist")
            else:
                # Check if scripts exist
                for script_name in referenced_scripts:
                    script_path = scripts_dir / script_name
                    if not script_path.exists():
                        self.add_warning(f"Referenced script doesn't exist: scripts/{script_name}")
                    elif script_path.suffix == '.py':
                        # Check if Python script has shebang
                        try:
                            first_line = script_path.read_text(encoding='utf-8').split('\n')[0]
                            if not first_line.startswith('#!'):
                                self.add_info(f"Python script {script_name} missing shebang line")
                        except Exception:
                            pass
        
        # Check for Windows-style paths (anti-pattern)
        if re.search(r'\\', content):
            for i, line in enumerate(lines, 1):
                if '\\' in line and 'reference' in line.lower() or 'scripts' in line.lower():
                    self.add_error(f"Windows-style path found (use forward slashes)", line=i)
    
    def validate_content_quality(self, content: str, lines: List[str]):
        """Check content quality and best practices"""
        
        # Check for time-sensitive language (anti-pattern)
        time_sensitive_phrases = [
            r'as of version',
            r'currently supports',
            r'the latest',
            r'recently added',
            r'in \d{4}',  # years
        ]
        
        for pattern in time_sensitive_phrases:
            matches = re.finditer(pattern, content, re.IGNORECASE)
            for match in matches:
                line_num = content[:match.start()].count('\n') + 1
                self.add_warning(f"Time-sensitive language found: '{match.group()}' (avoid in skills)", line=line_num)
        
        # Check for overly verbose language
        verbose_phrases = [
            r'it is important to note that',
            r'it should be noted',
            r'please be aware',
            r'as you can see',
            r'basically',
            r'simply put',
        ]
        
        for pattern in verbose_phrases:
            if re.search(pattern, content, re.IGNORECASE):
                self.add_info(f"Consider more concise language (found phrase like '{pattern}')")
        
        # Check for good practices
        if 'limitations' in content.lower() or 'constraints' in content.lower():
            self.add_info("✓ Good: Includes limitations/constraints section")
        
        if re.search(r'```(?:python|javascript|typescript|bash)', content):
            self.add_info("✓ Good: Includes code examples with language tags")
    
    def validate_anti_patterns(self, content: str, lines: List[str]):
        """Check for common anti-patterns"""
        
        # Check for "if/else if/else" without conditional hints
        if_count = len(re.findall(r'\bif\b', content, re.IGNORECASE))
        conditional_hints = len(re.findall(r'\*\*if\*\*|\*\*else\*\*', content, re.IGNORECASE))
        
        if if_count > 5 and conditional_hints == 0:
            self.add_warning("Multiple conditions found but not formatted with **IF**/**ELSE** (reduces clarity)")
        
        # Check for long paragraphs (> 10 lines)
        current_para_lines = 0
        for i, line in enumerate(lines, 1):
            if line.strip():
                current_para_lines += 1
                if current_para_lines > 10:
                    self.add_info(f"Long paragraph around line {i} (consider breaking up for readability)")
                    current_para_lines = 0
            else:
                current_para_lines = 0
        
        # Check for duplicate headings
        headings = [line for line in lines if line.startswith('#')]
        if len(headings) != len(set(headings)):
            self.add_warning("Duplicate heading found (can confuse navigation)")
    
    def print_results(self):
        """Print validation results"""
        total_issues = len(self.errors) + len(self.warnings) + len(self.info)
        
        if self.errors:
            print("ERRORS:")
            for error in self.errors:
                print(f"  {error}")
            print()
        
        if self.warnings:
            print("WARNINGS:")
            for warning in self.warnings:
                print(f"  {warning}")
            print()
        
        if self.info:
            print("INFO:")
            for info in self.info:
                print(f"  {info}")
            print()
        
        # Summary
        if not total_issues:
            print("✅ VALIDATION PASSED - No issues found!")
        elif not self.errors:
            print(f"✅ VALIDATION PASSED - {len(self.warnings)} warning(s), {len(self.info)} info item(s)")
        else:
            print(f"❌ VALIDATION FAILED - {len(self.errors)} error(s), {len(self.warnings)} warning(s)")

def find_skill_md(path: Path) -> Path:
    """Find SKILL.md file from path (file or directory)"""
    if path.is_file():
        if path.name == 'SKILL.md':
            return path
        else:
            print(f"ERROR: Expected SKILL.md, got {path.name}")
            sys.exit(1)
    elif path.is_dir():
        skill_md = path / 'SKILL.md'
        if skill_md.exists():
            return skill_md
        else:
            print(f"ERROR: No SKILL.md found in {path}")
            sys.exit(1)
    else:
        print(f"ERROR: Path not found: {path}")
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(
        description='Validate SKILL.md file structure and content',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python validate_skill.py path/to/SKILL.md
  python validate_skill.py path/to/skill-directory/
  
Validation checks:
  - Frontmatter structure and required fields
  - Name and description format
  - Line count recommendations
  - Reference file structure
  - Script references
  - Common anti-patterns
  - Content quality
        """
    )
    
    parser.add_argument(
        'path',
        type=Path,
        help='Path to SKILL.md file or skill directory'
    )
    
    parser.add_argument(
        '--strict',
        action='store_true',
        help='Treat warnings as errors'
    )
    
    args = parser.parse_args()
    
    try:
        skill_path = find_skill_md(args.path)
        validator = SkillValidator(skill_path)
        passed = validator.validate()
        
        if args.strict and validator.warnings:
            print("\n⚠️  Running in strict mode - warnings treated as errors")
            return 1
        
        return 0 if passed else 1
        
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
