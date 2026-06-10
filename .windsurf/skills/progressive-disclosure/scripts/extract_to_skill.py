#!/usr/bin/env python3
"""
Extract to Skill

Extracts a section from AGENTS.md into a new skill, updating AGENTS.md with a reference.
This helps maintain the instruction budget by moving detailed guidance to skills.

Usage:
    python extract_to_skill.py --section "Section Name"
    python extract_to_skill.py --section "Testing" --skill-name testing-strategy
    python extract_to_skill.py --lines 50-100 --skill-name custom-skill
"""

import argparse
import re
import sys
from pathlib import Path
from typing import Optional, Tuple

def find_section(content: str, section_name: str) -> Optional[Tuple[int, int, str]]:
    """Find a section in AGENTS.md by name. Returns (start_line, end_line, content)"""
    lines = content.split('\n')
    
    # Find section start
    start_idx = None
    section_level = None
    
    for i, line in enumerate(lines):
        if line.strip().startswith('#'):
            # Extract heading text
            heading_text = line.strip().lstrip('#').strip()
            if heading_text.lower() == section_name.lower():
                start_idx = i
                section_level = line.count('#', 0, line.index(heading_text))
                break
    
    if start_idx is None:
        return None
    
    # Find section end (next heading at same or higher level)
    end_idx = len(lines)
    for i in range(start_idx + 1, len(lines)):
        line = lines[i]
        if line.strip().startswith('#'):
            heading_level = len(line) - len(line.lstrip('#'))
            if heading_level <= section_level:
                end_idx = i
                break
    
    section_content = '\n'.join(lines[start_idx:end_idx])
    return (start_idx, end_idx, section_content)

def extract_by_lines(content: str, start_line: int, end_line: int) -> Tuple[int, int, str]:
    """Extract content by line numbers (1-indexed)"""
    lines = content.split('\n')
    
    # Convert to 0-indexed
    start_idx = start_line - 1
    end_idx = end_line
    
    if start_idx < 0 or end_idx > len(lines):
        raise ValueError(f"Line range {start_line}-{end_line} out of bounds (file has {len(lines)} lines)")
    
    section_content = '\n'.join(lines[start_idx:end_idx])
    return (start_idx, end_idx, section_content)

def generate_skill_name(section_name: str) -> str:
    """Generate a skill name from section heading"""
    # Convert to lowercase, replace spaces with hyphens
    name = section_name.lower()
    name = re.sub(r'[^a-z0-9\s-]', '', name)
    name = re.sub(r'\s+', '-', name)
    name = name.strip('-')
    return name

def create_skill_from_section(
    section_content: str,
    skill_name: str,
    project_path: Path
) -> Path:
    """Create a new skill from extracted section content"""
    
    skills_dir = project_path / ".windsurf" / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)
    
    skill_dir = skills_dir / skill_name
    if skill_dir.exists():
        print(f"ERROR: Skill directory already exists: {skill_dir}")
        sys.exit(1)
    
    skill_dir.mkdir()
    (skill_dir / "reference").mkdir()
    (skill_dir / "scripts").mkdir()
    
    # Generate description from first paragraph of content
    lines = [l for l in section_content.split('\n') if l.strip()]
    description = "TODO: Add description"
    
    # Try to find first substantial paragraph
    for line in lines[1:]:  # Skip heading
        if line.strip() and not line.strip().startswith('#'):
            description = line.strip()
            if len(description) > 1024:
                description = description[:1020] + "..."
            break
    
    # Create SKILL.md
    skill_title = skill_name.replace('-', ' ').title()
    
    skill_md_content = f"""---
name: {skill_name}
description: {description}
---

# {skill_title}

{section_content.strip()}

## Reference Documentation

For additional details, see:
- reference/guide.md

## Related Skills

[List related skills if applicable]
"""
    
    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text(skill_md_content, encoding='utf-8')
    
    # Create reference template
    reference_md = skill_dir / "reference" / "guide.md"
    reference_md.write_text(f"# {skill_title} - Detailed Guide\n\nTODO: Add detailed documentation here.\n", encoding='utf-8')
    
    print(f"✅ Created skill: {skill_name}")
    print(f"   Location: {skill_dir}")
    print(f"   Files: SKILL.md, reference/guide.md")
    
    return skill_dir

def update_agents_md(
    agents_md_path: Path,
    start_idx: int,
    end_idx: int,
    skill_name: str,
    section_name: str
) -> None:
    """Replace section in AGENTS.md with skill reference"""
    
    content = agents_md_path.read_text(encoding='utf-8')
    lines = content.split('\n')
    
    # Generate reference text
    reference_text = f"""## {section_name}

For {section_name.lower()} guidance, load the **{skill_name}** skill.

```
Load skill: {skill_name}
```
"""
    
    # Replace section
    new_lines = lines[:start_idx] + reference_text.split('\n') + lines[end_idx:]
    new_content = '\n'.join(new_lines)
    
    agents_md_path.write_text(new_content, encoding='utf-8')
    
    print(f"✅ Updated AGENTS.md with skill reference")

def main():
    parser = argparse.ArgumentParser(
        description='Extract section from AGENTS.md into a skill',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Extract by section name
  python extract_to_skill.py --section "Testing Strategy"
  
  # Extract with custom skill name
  python extract_to_skill.py --section "API Design" --skill-name api-conventions
  
  # Extract by line numbers
  python extract_to_skill.py --lines 50-100 --skill-name custom-skill
  
  # Dry run (don't modify files)
  python extract_to_skill.py --section "Deployment" --dry-run
        """
    )
    
    parser.add_argument(
        '--section',
        help='Section name to extract from AGENTS.md'
    )
    
    parser.add_argument(
        '--lines',
        help='Line range to extract (e.g., 50-100)'
    )
    
    parser.add_argument(
        '--skill-name',
        help='Name for the new skill (auto-generated from section if not provided)'
    )
    
    parser.add_argument(
        '--path',
        type=Path,
        default=Path.cwd(),
        help='Project directory (default: current directory)'
    )
    
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be done without modifying files'
    )
    
    args = parser.parse_args()
    
    if not args.section and not args.lines:
        print("ERROR: Must specify either --section or --lines")
        parser.print_help()
        return 1
    
    project_path = args.path.resolve()
    agents_md_path = project_path / "AGENTS.md"
    
    if not agents_md_path.exists():
        print(f"ERROR: AGENTS.md not found at {agents_md_path}")
        print(f"\nRun: python scripts/init_agents_md.py")
        return 1
    
    # Read AGENTS.md
    content = agents_md_path.read_text(encoding='utf-8')
    
    # Extract section
    if args.section:
        result = find_section(content, args.section)
        if not result:
            print(f"ERROR: Section '{args.section}' not found in AGENTS.md")
            print(f"\nAvailable sections:")
            lines = content.split('\n')
            for line in lines:
                if line.strip().startswith('#'):
                    print(f"  - {line.strip().lstrip('#').strip()}")
            return 1
        
        start_idx, end_idx, section_content = result
        section_name = args.section
    else:
        # Extract by lines
        try:
            start_line, end_line = map(int, args.lines.split('-'))
            start_idx, end_idx, section_content = extract_by_lines(content, start_line, end_line)
            section_name = args.skill_name or f"Lines {start_line}-{end_line}"
        except ValueError as e:
            print(f"ERROR: Invalid line range: {e}")
            return 1
    
    # Generate skill name
    if args.skill_name:
        skill_name = args.skill_name
    else:
        skill_name = generate_skill_name(section_name)
    
    # Validate skill name
    if not re.match(r'^[a-z0-9]+(-[a-z0-9]+)*$', skill_name):
        print(f"ERROR: Invalid skill name '{skill_name}'")
        print("Must be lowercase, alphanumeric, and hyphens only")
        return 1
    
    print(f"\nExtraction Plan")
    print(f"{'=' * 60}")
    print(f"Section: {section_name}")
    print(f"Lines: {start_idx + 1}-{end_idx}")
    print(f"Skill name: {skill_name}")
    print(f"Content preview: {section_content[:100]}...")
    
    if args.dry_run:
        print(f"\n[DRY RUN] Would create:")
        print(f"  - .windsurf/skills/{skill_name}/SKILL.md")
        print(f"  - .windsurf/skills/{skill_name}/reference/guide.md")
        print(f"\n[DRY RUN] Would update:")
        print(f"  - AGENTS.md (replace lines {start_idx + 1}-{end_idx} with skill reference)")
        return 0
    
    # Confirm
    response = input(f"\nProceed with extraction? [y/N]: ").strip().lower()
    if response != 'y':
        print("Cancelled.")
        return 0
    
    try:
        # Create skill
        skill_dir = create_skill_from_section(section_content, skill_name, project_path)
        
        # Update AGENTS.md
        update_agents_md(agents_md_path, start_idx, end_idx, skill_name, section_name)
        
        print(f"\n✅ Extraction complete!")
        print(f"\nNext steps:")
        print(f"1. Edit {skill_dir / 'SKILL.md'} and refine content")
        print(f"2. Update description in frontmatter")
        print(f"3. Run: python scripts/update_skill_references.py")
        print(f"4. Run: python scripts/validate_progressive_disclosure.py")
        
        return 0
        
    except Exception as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
