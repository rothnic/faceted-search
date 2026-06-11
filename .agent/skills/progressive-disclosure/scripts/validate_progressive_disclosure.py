#!/usr/bin/env python3
"""
Validate Progressive Disclosure Setup

Validates that AGENTS.md and skills are properly configured for
progressive disclosure following best practices.

Usage:
    python validate_progressive_disclosure.py
    python validate_progressive_disclosure.py --path /path/to/project
    python validate_progressive_disclosure.py --strict
"""

import argparse
import re
import sys
from pathlib import Path
from typing import List, Dict, Set

class ValidationIssue:
    def __init__(self, severity: str, category: str, message: str, fix: str = None):
        self.severity = severity  # error, warning, info
        self.category = category
        self.message = message
        self.fix = fix
    
    def __str__(self):
        symbol = {"error": "❌", "warning": "⚠️", "info": "ℹ️"}[self.severity]
        result = f"{symbol} [{self.category.upper()}] {self.message}"
        if self.fix:
            result += f"\n   Fix: {self.fix}"
        return result

class ProgressiveDisclosureValidator:
    def __init__(self, project_path: Path):
        self.project_path = project_path
        self.agents_md = project_path / "AGENTS.md"
        self.skills_dir = project_path / ".windsurf" / "skills"
        self.issues: List[ValidationIssue] = []
        
    def validate(self) -> bool:
        """Run all validations. Returns True if no errors."""
        print(f"Validating progressive disclosure setup")
        print(f"{'=' * 60}\n")
        
        self.validate_agents_md_exists()
        self.validate_agents_md_structure()
        self.validate_agents_md_length()
        self.validate_skill_references()
        self.validate_skills_structure()
        self.validate_no_duplication()
        
        self.print_results()
        
        errors = [i for i in self.issues if i.severity == "error"]
        return len(errors) == 0
    
    def add_issue(self, severity: str, category: str, message: str, fix: str = None):
        self.issues.append(ValidationIssue(severity, category, message, fix))
    
    def validate_agents_md_exists(self):
        """Check if AGENTS.md exists"""
        if not self.agents_md.exists():
            self.add_issue(
                "error",
                "missing",
                "AGENTS.md does not exist",
                "python scripts/init_agents_md.py"
            )
    
    def validate_agents_md_structure(self):
        """Validate AGENTS.md has recommended structure"""
        if not self.agents_md.exists():
            return
        
        content = self.agents_md.read_text(encoding='utf-8')
        
        # Check for project overview
        if not re.search(r'^#\s+.*(?:overview|project)', content, re.IGNORECASE | re.MULTILINE):
            self.add_issue(
                "warning",
                "structure",
                "Missing project overview section",
                "Add a heading like '# Project Overview' with one-sentence description"
            )
        
        # Check for skills section
        if not re.search(r'^##\s+Skills?\s+Available', content, re.IGNORECASE | re.MULTILINE):
            self.add_issue(
                "warning",
                "structure",
                "Missing 'Skills Available' section",
                "python scripts/update_skill_references.py"
            )
    
    def validate_agents_md_length(self):
        """Validate AGENTS.md length is within budget"""
        if not self.agents_md.exists():
            return
        
        content = self.agents_md.read_text(encoding='utf-8')
        lines = [l for l in content.split('\n') if l.strip()]
        line_count = len(lines)
        
        # Estimate instructions
        instruction_indicators = ['-', '*', 'must', 'should', 'always', 'never', 'use ', 'do ']
        instruction_count = sum(1 for line in lines if any(ind in line.lower() for ind in instruction_indicators))
        
        if line_count > 200:
            self.add_issue(
                "error",
                "length",
                f"AGENTS.md has {line_count} lines (hard limit: 200)",
                "python scripts/extract_to_skill.py to move content to skills"
            )
        elif line_count > 150:
            self.add_issue(
                "warning",
                "length",
                f"AGENTS.md has {line_count} lines (recommended: 50-150)",
                "Consider extracting sections to skills"
            )
        
        if instruction_count > 200:
            self.add_issue(
                "error",
                "instructions",
                f"~{instruction_count} instructions (budget: 150-200)",
                "Extract detailed guidance to skills"
            )
        elif instruction_count > 150:
            self.add_issue(
                "warning",
                "instructions",
                f"~{instruction_count} instructions (approaching budget limit)",
                "Consider extracting to skills"
            )
    
    def validate_skill_references(self):
        """Validate skill references in AGENTS.md"""
        if not self.agents_md.exists():
            return
        
        content = self.agents_md.read_text(encoding='utf-8')
        
        # Find skill references in AGENTS.md
        referenced_skills = set()
        
        # Pattern: **skill-name**
        for match in re.finditer(r'\*\*([a-z0-9-]+)\*\*', content):
            skill_name = match.group(1)
            if not skill_name.startswith('http'):  # Avoid URLs
                referenced_skills.add(skill_name)
        
        # Get actual skills
        actual_skills = set()
        if self.skills_dir.exists():
            for skill_dir in self.skills_dir.iterdir():
                if skill_dir.is_dir() and (skill_dir / "SKILL.md").exists():
                    # Try to get name from SKILL.md
                    try:
                        skill_content = (skill_dir / "SKILL.md").read_text(encoding='utf-8')
                        name_match = re.search(r'name:\s*([a-z0-9-]+)', skill_content)
                        if name_match:
                            actual_skills.add(name_match.group(1))
                        else:
                            actual_skills.add(skill_dir.name)
                    except:
                        actual_skills.add(skill_dir.name)
        
        # Find unreferenced skills
        unreferenced = actual_skills - referenced_skills
        if unreferenced:
            self.add_issue(
                "warning",
                "discovery",
                f"{len(unreferenced)} skill(s) not referenced in AGENTS.md: {', '.join(sorted(unreferenced))}",
                "python scripts/update_skill_references.py"
            )
        
        # Find invalid references
        invalid = referenced_skills - actual_skills
        if invalid:
            for skill_name in sorted(invalid):
                self.add_issue(
                    "warning",
                    "reference",
                    f"AGENTS.md references non-existent skill: {skill_name}",
                    f"Remove reference or create skill"
                )
    
    def validate_skills_structure(self):
        """Validate individual skills"""
        if not self.skills_dir.exists():
            self.add_issue(
                "info",
                "skills",
                "No skills directory found",
                "Create skills to extract content from AGENTS.md"
            )
            return
        
        skill_count = 0
        for skill_dir in self.skills_dir.iterdir():
            if not skill_dir.is_dir():
                continue
            
            skill_md = skill_dir / "SKILL.md"
            if not skill_md.exists():
                self.add_issue(
                    "warning",
                    "skill",
                    f"Skill directory {skill_dir.name} missing SKILL.md",
                    f"Remove directory or add SKILL.md"
                )
                continue
            
            skill_count += 1
            
            # Validate frontmatter
            content = skill_md.read_text(encoding='utf-8')
            
            if not content.startswith('---'):
                self.add_issue(
                    "error",
                    "skill",
                    f"Skill {skill_dir.name}/SKILL.md missing frontmatter",
                    "Add YAML frontmatter with name and description"
                )
                continue
            
            # Check for name and description
            if 'name:' not in content[:500]:
                self.add_issue(
                    "error",
                    "skill",
                    f"Skill {skill_dir.name}/SKILL.md missing 'name' field",
                    "Add 'name: skill-name' to frontmatter"
                )
            
            if 'description:' not in content[:500]:
                self.add_issue(
                    "error",
                    "skill",
                    f"Skill {skill_dir.name}/SKILL.md missing 'description' field",
                    "Add 'description: ...' to frontmatter"
                )
            
            # Check line count
            lines = [l for l in content.split('\n') if l.strip()]
            if len(lines) > 500:
                self.add_issue(
                    "warning",
                    "skill",
                    f"Skill {skill_dir.name}/SKILL.md has {len(lines)} lines (recommended: <500)",
                    "Move detailed content to reference/ files"
                )
        
        if skill_count == 0:
            self.add_issue(
                "info",
                "skills",
                "No skills found",
                "Create skills: python scripts/create_skill_template.py"
            )
    
    def validate_no_duplication(self):
        """Check for content duplication between AGENTS.md and skills"""
        if not self.agents_md.exists() or not self.skills_dir.exists():
            return
        
        agents_content = self.agents_md.read_text(encoding='utf-8').lower()
        
        # Get skill content
        for skill_dir in self.skills_dir.iterdir():
            if not skill_dir.is_dir():
                continue
            
            skill_md = skill_dir / "SKILL.md"
            if not skill_md.exists():
                continue
            
            skill_content = skill_md.read_text(encoding='utf-8').lower()
            
            # Look for substantial duplicated paragraphs (50+ chars)
            skill_paragraphs = [p.strip() for p in skill_content.split('\n\n') if len(p.strip()) > 50]
            
            for para in skill_paragraphs[:10]:  # Check first 10 paragraphs
                # Remove frontmatter and markdown formatting for comparison
                clean_para = re.sub(r'[*_`#-]', '', para)
                clean_agents = re.sub(r'[*_`#-]', '', agents_content)
                
                if clean_para in clean_agents:
                    preview = para[:80] + "..." if len(para) > 80 else para
                    self.add_issue(
                        "warning",
                        "duplication",
                        f"Potential content duplication between AGENTS.md and {skill_dir.name}: '{preview}'",
                        "Remove duplicated content from AGENTS.md or skill"
                    )
                    break  # Only report once per skill
    
    def print_results(self):
        """Print validation results"""
        errors = [i for i in self.issues if i.severity == "error"]
        warnings = [i for i in self.issues if i.severity == "warning"]
        info = [i for i in self.issues if i.severity == "info"]
        
        if errors:
            print(f"ERRORS ({len(errors)}):")
            for issue in errors:
                print(f"  {issue}\n")
        
        if warnings:
            print(f"WARNINGS ({len(warnings)}):")
            for issue in warnings:
                print(f"  {issue}\n")
        
        if info:
            print(f"INFO ({len(info)}):")
            for issue in info:
                print(f"  {issue}\n")
        
        # Summary
        if not errors and not warnings:
            print(f"✅ VALIDATION PASSED - Progressive disclosure setup looks good!")
        elif not errors:
            print(f"✅ VALIDATION PASSED - {len(warnings)} warning(s), {len(info)} info item(s)")
        else:
            print(f"❌ VALIDATION FAILED - {len(errors)} error(s), {len(warnings)} warning(s)")

def main():
    parser = argparse.ArgumentParser(
        description='Validate progressive disclosure setup',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Validate current project
  python validate_progressive_disclosure.py
  
  # Validate specific project
  python validate_progressive_disclosure.py --path /path/to/project
  
  # Strict mode (warnings treated as errors)
  python validate_progressive_disclosure.py --strict
        """
    )
    
    parser.add_argument(
        '--path',
        type=Path,
        default=Path.cwd(),
        help='Project directory (default: current directory)'
    )
    
    parser.add_argument(
        '--strict',
        action='store_true',
        help='Treat warnings as errors'
    )
    
    args = parser.parse_args()
    
    validator = ProgressiveDisclosureValidator(args.path.resolve())
    passed = validator.validate()
    
    if args.strict and any(i.severity == "warning" for i in validator.issues):
        print(f"\n⚠️  Running in strict mode - warnings treated as errors")
        return 1
    
    return 0 if passed else 1

if __name__ == '__main__':
    sys.exit(main())
