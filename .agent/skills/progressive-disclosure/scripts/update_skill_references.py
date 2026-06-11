#!/usr/bin/env python3
"""
Update Skill References in AGENTS.md

Scans available skills and generates/updates a "Skills Available" section
in AGENTS.md with semantic hints to help agents discover when to load skills.

Usage:
    python update_skill_references.py
    python update_skill_references.py --path /path/to/project
    python update_skill_references.py --priority
"""

import argparse
import re
import sys
from pathlib import Path
from typing import List, Dict, Optional

def scan_skills(skills_dir: Path) -> List[Dict]:
    """Scan and extract skill information"""
    if not skills_dir.exists():
        return []
    
    skills = []
    for skill_dir in skills_dir.iterdir():
        if not skill_dir.is_dir():
            continue
        
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue
        
        try:
            content = skill_md.read_text(encoding='utf-8')
            
            # Extract frontmatter
            name = None
            description = None
            
            if content.startswith('---'):
                end_idx = content.index('---', 3)
                frontmatter = content[3:end_idx]
                
                name_match = re.search(r'name:\s*(.+)', frontmatter)
                if name_match:
                    name = name_match.group(1).strip()
                
                desc_match = re.search(r'description:\s*(.+?)(?=\n[a-z]+:|$)', frontmatter, re.DOTALL)
                if desc_match:
                    description = desc_match.group(1).strip()
            
            if not name or not description:
                continue
            
            # Extract trigger words from description
            triggers = extract_triggers(description)
            
            skills.append({
                'name': name,
                'directory': skill_dir.name,
                'description': description,
                'triggers': triggers,
                'priority': infer_priority(name, description)
            })
        except Exception as e:
            print(f"Warning: Error analyzing {skill_dir.name}: {e}", file=sys.stderr)
    
    return skills

def extract_triggers(description: str) -> List[str]:
    """Extract trigger conditions from description"""
    triggers = []
    
    # Look for "when" clauses
    when_pattern = r'[Ww]hen\s+([^.]+)'
    for match in re.finditer(when_pattern, description):
        triggers.append(match.group(1).strip())
    
    # Look for "use for" clauses
    use_pattern = r'[Uu]se\s+(?:when|for)\s+([^.]+)'
    for match in re.finditer(use_pattern, description):
        trigger = match.group(1).strip()
        if trigger not in triggers:
            triggers.append(trigger)
    
    return triggers

def infer_priority(name: str, description: str) -> str:
    """Infer skill priority from name and description"""
    name_lower = name.lower()
    desc_lower = description.lower()
    
    # Critical keywords
    critical_keywords = ['security', 'authentication', 'authorization', 'critical', 'must', 'required']
    if any(kw in name_lower or kw in desc_lower for kw in critical_keywords):
        return 'critical'
    
    # Helpful keywords
    helpful_keywords = ['style', 'format', 'convention', 'preference', 'guide']
    if any(kw in name_lower or kw in desc_lower for kw in helpful_keywords):
        return 'helpful'
    
    # Default to important
    return 'important'

def generate_skills_section(skills: List[Dict], include_priority: bool = False) -> str:
    """Generate the Skills Available section"""
    
    if not skills:
        return """## Skills Available

No skills configured yet. Skills provide detailed guidance loaded on demand.

To create your first skill:
```bash
python scripts/create_skill_template.py --name my-skill --scope project
```
"""
    
    if include_priority:
        # Group by priority
        critical = [s for s in skills if s['priority'] == 'critical']
        important = [s for s in skills if s['priority'] == 'important']
        helpful = [s for s in skills if s['priority'] == 'helpful']
        
        sections = []
        
        if critical:
            sections.append("**Critical** (always follow):")
            for skill in sorted(critical, key=lambda s: s['name']):
                trigger = skill['triggers'][0] if skill['triggers'] else skill['description'][:60]
                sections.append(f"- **{skill['name']}**: {trigger}")
        
        if important:
            if sections:
                sections.append("")
            sections.append("**Important** (follow for these domains):")
            for skill in sorted(important, key=lambda s: s['name']):
                trigger = skill['triggers'][0] if skill['triggers'] else skill['description'][:60]
                sections.append(f"- **{skill['name']}**: {trigger}")
        
        if helpful:
            if sections:
                sections.append("")
            sections.append("**Helpful** (reference for guidance):")
            for skill in sorted(helpful, key=lambda s: s['name']):
                trigger = skill['triggers'][0] if skill['triggers'] else skill['description'][:60]
                sections.append(f"- **{skill['name']}**: {trigger}")
        
        content = "\n".join(sections)
    else:
        # Simple list
        lines = ["This project uses skills for detailed guidance. Load the appropriate skill when working in these areas:", ""]
        
        for skill in sorted(skills, key=lambda s: s['name']):
            if skill['triggers']:
                # Use first trigger as the hint
                hint = skill['triggers'][0]
            else:
                # Fall back to first sentence of description
                hint = skill['description'].split('.')[0]
            
            lines.append(f"- **{skill['name']}**: {hint}")
        
        content = "\n".join(lines)
    
    return f"""## Skills Available

{content}
"""

def find_skills_section(content: str) -> Optional[tuple]:
    """Find existing Skills Available section. Returns (start_line, end_line) or None"""
    lines = content.split('\n')
    
    start_idx = None
    for i, line in enumerate(lines):
        if re.match(r'^##\s+Skills?\s+Available', line, re.IGNORECASE):
            start_idx = i
            break
    
    if start_idx is None:
        return None
    
    # Find end (next ## heading or end of file)
    end_idx = len(lines)
    for i in range(start_idx + 1, len(lines)):
        if lines[i].startswith('## '):
            end_idx = i
            break
    
    return (start_idx, end_idx)

def update_agents_md(
    agents_md_path: Path,
    skills_section: str,
    insert_before: Optional[str] = None
) -> bool:
    """Update or insert Skills Available section in AGENTS.md"""
    
    if not agents_md_path.exists():
        print(f"ERROR: AGENTS.md not found at {agents_md_path}")
        return False
    
    content = agents_md_path.read_text(encoding='utf-8')
    lines = content.split('\n')
    
    # Find existing section
    existing = find_skills_section(content)
    
    if existing:
        # Replace existing section
        start_idx, end_idx = existing
        new_lines = lines[:start_idx] + skills_section.rstrip().split('\n') + [''] + lines[end_idx:]
        print(f"✅ Updated existing 'Skills Available' section at line {start_idx + 1}")
    else:
        # Insert new section
        if insert_before:
            # Find insertion point
            insert_idx = None
            for i, line in enumerate(lines):
                if line.strip().startswith('## ') and insert_before.lower() in line.lower():
                    insert_idx = i
                    break
            
            if insert_idx:
                new_lines = lines[:insert_idx] + [''] + skills_section.rstrip().split('\n') + [''] + lines[insert_idx:]
                print(f"✅ Inserted 'Skills Available' section before '{insert_before}' at line {insert_idx + 1}")
            else:
                # Append at end
                new_lines = lines + ['', ''] + skills_section.rstrip().split('\n')
                print(f"✅ Appended 'Skills Available' section at end of file")
        else:
            # Insert after Development Setup or first section
            insert_idx = None
            for i, line in enumerate(lines):
                if 'development' in line.lower() or 'setup' in line.lower():
                    # Find end of this section
                    for j in range(i + 1, len(lines)):
                        if lines[j].startswith('## '):
                            insert_idx = j
                            break
                    break
            
            if insert_idx:
                new_lines = lines[:insert_idx] + [''] + skills_section.rstrip().split('\n') + [''] + lines[insert_idx:]
                print(f"✅ Inserted 'Skills Available' section at line {insert_idx + 1}")
            else:
                # Append at end
                new_lines = lines + ['', ''] + skills_section.rstrip().split('\n')
                print(f"✅ Appended 'Skills Available' section at end of file")
    
    new_content = '\n'.join(new_lines)
    agents_md_path.write_text(new_content, encoding='utf-8')
    
    return True

def main():
    parser = argparse.ArgumentParser(
        description='Update skill references in AGENTS.md',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Update skill references
  python update_skill_references.py
  
  # Include priority levels (critical, important, helpful)
  python update_skill_references.py --priority
  
  # Specify project path
  python update_skill_references.py --path /path/to/project
  
  # Insert before specific section
  python update_skill_references.py --insert-before "Critical Conventions"
        """
    )
    
    parser.add_argument(
        '--path',
        type=Path,
        default=Path.cwd(),
        help='Project directory (default: current directory)'
    )
    
    parser.add_argument(
        '--priority',
        action='store_true',
        help='Group skills by priority (critical, important, helpful)'
    )
    
    parser.add_argument(
        '--insert-before',
        help='Insert before this section (if creating new)'
    )
    
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be generated without modifying AGENTS.md'
    )
    
    args = parser.parse_args()
    
    project_path = args.path.resolve()
    agents_md_path = project_path / "AGENTS.md"
    skills_dir = project_path / ".windsurf" / "skills"
    
    print(f"Updating skill references in AGENTS.md")
    print(f"{'=' * 60}\n")
    
    # Scan skills
    print(f"Scanning skills directory: {skills_dir}")
    skills = scan_skills(skills_dir)
    
    if not skills:
        print(f"⚠️  No skills found in {skills_dir}")
        print(f"\nCreate your first skill:")
        print(f"  python scripts/create_skill_template.py --name my-skill --scope project")
        return 1
    
    print(f"Found {len(skills)} skill(s):\n")
    for skill in sorted(skills, key=lambda s: s['name']):
        print(f"  - {skill['name']} ({skill['priority']})")
        if skill['triggers']:
            print(f"    Triggers: {', '.join(skill['triggers'][:2])}")
    
    print()
    
    # Generate section
    skills_section = generate_skills_section(skills, include_priority=args.priority)
    
    if args.dry_run:
        print(f"[DRY RUN] Would add/update this section in AGENTS.md:\n")
        print(skills_section)
        return 0
    
    # Update AGENTS.md
    success = update_agents_md(
        agents_md_path,
        skills_section,
        insert_before=args.insert_before
    )
    
    if success:
        print(f"\n✅ AGENTS.md updated successfully")
        print(f"\nNext steps:")
        print(f"1. Review the updated AGENTS.md")
        print(f"2. Run: python scripts/validate_progressive_disclosure.py")
        return 0
    else:
        return 1

if __name__ == '__main__':
    sys.exit(main())
