#!/usr/bin/env python3
"""
Skill Template Generator

Creates a new skill directory structure with placeholder files
following best practices for skill organization.

Usage:
    python create_skill_template.py --name my-skill-name --scope project
    python create_skill_template.py --name shared-skill --scope shared --path ~/skills/
"""

import argparse
import sys
from pathlib import Path
from typing import Literal

SKILL_MD_TEMPLATE = """---
name: {name}
description: TODO - Add description (what this skill does and when to use it)
---

# {title}

TODO: Brief overview (2-3 sentences explaining the skill's purpose)

## When to Use This Skill

TODO: List specific scenarios when this skill should be loaded:
- Scenario 1
- Scenario 2
- Scenario 3

## Core Instructions

TODO: Add main workflow or instructions here

## Reference Documentation

For detailed information, see:
- `reference/TODO.md` - Detailed guide
- `reference/examples.md` - Usage examples

## Scripts

Available helper scripts:
- `scripts/TODO.py` - Description of what it does

## Quick Reference

TODO: Add quick reference information agents need frequently
"""

REFERENCE_TEMPLATE = """# {title}

TODO: Add detailed documentation that supports the main SKILL.md file

## Table of Contents
- Section 1 (line XX)
- Section 2 (line XX)
- Section 3 (line XX)

## Section 1

TODO: Detailed content

## Section 2

TODO: Detailed content

## Section 3

TODO: Detailed content
"""

EXAMPLES_TEMPLATE = """# Examples

This file contains concrete examples demonstrating how to use this skill.

## Example 1: [Name]

**Scenario**: TODO - Describe the scenario

**Task**: TODO - What the agent needs to do

**Solution**:
```
TODO: Show the solution
```

**Explanation**: TODO - Explain key points

---

## Example 2: [Name]

**Scenario**: TODO - Describe the scenario

**Task**: TODO - What the agent needs to do

**Solution**:
```
TODO: Show the solution
```

**Explanation**: TODO - Explain key points

---

## Example 3: [Name]

TODO: Add more examples as needed
"""

SCRIPT_TEMPLATE = """#!/usr/bin/env python3
\"\"\"
TODO: Script description

Usage:
    python {script_name} [arguments]
\"\"\"

import sys
import argparse

def main():
    parser = argparse.ArgumentParser(description='TODO: Script description')
    # TODO: Add arguments
    parser.add_argument('input', help='TODO: Input description')
    
    args = parser.parse_args()
    
    # TODO: Implement script logic
    print("TODO: Implement script functionality")
    
    return 0

if __name__ == '__main__':
    sys.exit(main())
"""

README_TEMPLATE = """# {title} Skill

TODO: Add comprehensive description of this skill

## Purpose

TODO: Explain what problem this skill solves

## Structure

```
{name}/
├── SKILL.md              # Core skill instructions
├── README.md             # This file
├── scripts/              # Helper scripts
│   └── TODO.py
└── reference/            # Detailed documentation
    ├── guide.md
    └── examples.md
```

## Usage

TODO: Explain how to use this skill

## Testing

TODO: Document test cases and evaluation criteria

## Maintenance

TODO: Document who maintains this and how to update it
"""

def create_skill_template(
    name: str,
    scope: Literal["project", "shared", "team"],
    base_path: Path | None = None
) -> Path:
    """Create a new skill template directory structure"""
    
    # Validate skill name
    if not name.replace('-', '').replace('_', '').isalnum():
        print(f"ERROR: Skill name must contain only letters, numbers, hyphens, and underscores")
        sys.exit(1)
    
    # Convert underscores to hyphens (convention)
    name = name.replace('_', '-').lower()
    
    # Determine base path
    if base_path is None:
        if scope == "project":
            base_path = Path.cwd() / ".windsurf" / "skills"
        elif scope == "shared":
            base_path = Path.home() / ".windsurf" / "skills"
        elif scope == "team":
            # Default to current directory, user should specify
            base_path = Path.cwd() / "team-skills"
    
    skill_dir = base_path / name
    
    # Check if already exists
    if skill_dir.exists():
        print(f"ERROR: Skill directory already exists: {skill_dir}")
        sys.exit(1)
    
    # Create directory structure
    print(f"Creating skill template: {skill_dir}")
    skill_dir.mkdir(parents=True, exist_ok=True)
    
    scripts_dir = skill_dir / "scripts"
    scripts_dir.mkdir(exist_ok=True)
    
    reference_dir = skill_dir / "reference"
    reference_dir.mkdir(exist_ok=True)
    
    # Create SKILL.md
    title = name.replace('-', ' ').title()
    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text(SKILL_MD_TEMPLATE.format(name=name, title=title))
    print(f"  ✓ Created {skill_md.relative_to(skill_dir.parent.parent)}")
    
    # Create README.md
    readme = skill_dir / "README.md"
    readme.write_text(README_TEMPLATE.format(name=name, title=title))
    print(f"  ✓ Created {readme.relative_to(skill_dir.parent.parent)}")
    
    # Create reference files
    guide_md = reference_dir / "guide.md"
    guide_md.write_text(REFERENCE_TEMPLATE.format(title="Detailed Guide"))
    print(f"  ✓ Created {guide_md.relative_to(skill_dir.parent.parent)}")
    
    examples_md = reference_dir / "examples.md"
    examples_md.write_text(EXAMPLES_TEMPLATE)
    print(f"  ✓ Created {examples_md.relative_to(skill_dir.parent.parent)}")
    
    # Create example script
    example_script = scripts_dir / "example_script.py"
    example_script.write_text(SCRIPT_TEMPLATE.format(script_name="example_script.py"))
    example_script.chmod(0o755)  # Make executable
    print(f"  ✓ Created {example_script.relative_to(skill_dir.parent.parent)}")
    
    # Create .gitkeep files for empty directories (if using git)
    gitkeep_script = scripts_dir / ".gitkeep"
    gitkeep_script.touch()
    
    gitkeep_ref = reference_dir / ".gitkeep"
    gitkeep_ref.touch()
    
    print(f"\n✅ Skill template created successfully!")
    print(f"\nNext steps:")
    print(f"1. Edit {skill_md} and replace TODO placeholders")
    print(f"2. Fill in the description field (max 1024 chars)")
    print(f"3. Add detailed content to reference files")
    print(f"4. Implement any needed scripts in scripts/")
    print(f"5. Run validation: python scripts/validate_skill.py {skill_md}")
    print(f"\nSkill location: {skill_dir}")
    print(f"Scope: {scope}")
    
    return skill_dir

def main():
    parser = argparse.ArgumentParser(
        description='Create a new AI agent skill template',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Create project-specific skill
  python create_skill_template.py --name api-integration --scope project
  
  # Create shared personal skill
  python create_skill_template.py --name python-style --scope shared
  
  # Create team skill in custom location
  python create_skill_template.py --name security-review --scope team --path ./team-skills/
        """
    )
    
    parser.add_argument(
        '--name',
        required=True,
        help='Skill name (lowercase, hyphens for spaces)'
    )
    
    parser.add_argument(
        '--scope',
        required=True,
        choices=['project', 'shared', 'team'],
        help='Skill scope: project (repo), shared (personal), or team (shared repo)'
    )
    
    parser.add_argument(
        '--path',
        type=Path,
        help='Custom base path (optional, defaults based on scope)'
    )
    
    args = parser.parse_args()
    
    try:
        create_skill_template(args.name, args.scope, args.path)
        return 0
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
