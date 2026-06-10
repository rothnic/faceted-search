#!/usr/bin/env python3
"""
AGENTS.md Initializer

Creates a minimal AGENTS.md file if missing, or analyzes existing one
and suggests improvements based on best practices.

Usage:
    python init_agents_md.py
    python init_agents_md.py --path /path/to/project
    python init_agents_md.py --analyze-only
"""

import argparse
import sys
from pathlib import Path
from typing import Optional

AGENTS_MD_TEMPLATE = """# Project Overview

{project_description}

## Development Setup

- Package manager: {package_manager}
- Build: `{build_command}`
- Test: `{test_command}`

## Skills Available

This project uses skills for detailed guidance. Load the appropriate skill when working in these areas:

{skill_references}

## Critical Conventions

{conventions}
"""

def detect_package_manager(project_path: Path) -> str:
    """Detect package manager from lock files"""
    if (project_path / "pnpm-lock.yaml").exists():
        return "pnpm"
    elif (project_path / "yarn.lock").exists():
        return "yarn"
    elif (project_path / "package-lock.json").exists():
        return "npm"
    elif (project_path / "Pipfile").exists():
        return "pipenv"
    elif (project_path / "poetry.lock").exists():
        return "poetry"
    elif (project_path / "requirements.txt").exists():
        return "pip"
    elif (project_path / "Cargo.lock").exists():
        return "cargo"
    elif (project_path / "go.mod").exists():
        return "go modules"
    else:
        return "[specify package manager]"

def detect_project_type(project_path: Path) -> str:
    """Detect project type from files"""
    if (project_path / "package.json").exists():
        return "Node.js project"
    elif (project_path / "setup.py").exists() or (project_path / "pyproject.toml").exists():
        return "Python project"
    elif (project_path / "Cargo.toml").exists():
        return "Rust project"
    elif (project_path / "go.mod").exists():
        return "Go project"
    elif (project_path / "pom.xml").exists():
        return "Java project"
    elif (project_path / "build.gradle").exists():
        return "Gradle project"
    else:
        return "[describe your project]"

def scan_for_skills(project_path: Path) -> list:
    """Scan for existing skills in the project"""
    skills_dir = project_path / ".windsurf" / "skills"
    
    if not skills_dir.exists():
        return []
    
    skills = []
    for skill_dir in skills_dir.iterdir():
        if skill_dir.is_dir():
            skill_md = skill_dir / "SKILL.md"
            if skill_md.exists():
                # Try to extract description
                content = skill_md.read_text(encoding='utf-8')
                description = None
                for line in content.split('\n'):
                    if line.startswith('description:'):
                        description = line.split('description:')[1].strip()
                        # Truncate to first sentence
                        if '.' in description:
                            description = description.split('.')[0] + '.'
                        break
                
                skills.append({
                    'name': skill_dir.name,
                    'description': description or "TODO: Add description"
                })
    
    return skills

def create_agents_md(project_path: Path, interactive: bool = True) -> bool:
    """Create a new AGENTS.md file"""
    agents_md = project_path / "AGENTS.md"
    
    if agents_md.exists():
        print(f"ERROR: AGENTS.md already exists at {agents_md}")
        return False
    
    print("Creating AGENTS.md...\n")
    
    # Detect project details
    package_manager = detect_package_manager(project_path)
    project_type = detect_project_type(project_path)
    skills = scan_for_skills(project_path)
    
    # Interactive prompts if requested
    if interactive:
        print(f"Detected project type: {project_type}")
        project_description = input("Enter project description (one sentence): ").strip()
        if not project_description:
            project_description = project_type
        
        print(f"\nDetected package manager: {package_manager}")
        if package_manager.startswith('['):
            package_manager = input("Enter package manager: ").strip() or package_manager
        
        build_command = input("Enter build command (or press Enter for default): ").strip()
        if not build_command:
            build_command = "[build command if non-standard]"
        
        test_command = input("Enter test command (or press Enter for default): ").strip()
        if not test_command:
            test_command = "[test command if non-standard]"
    else:
        project_description = project_type
        build_command = "[build command if non-standard]"
        test_command = "[test command if non-standard]"
    
    # Generate skill references
    if skills:
        skill_references = "\n".join([
            f"- **{skill['name']}**: {skill['description']}"
            for skill in skills
        ])
    else:
        skill_references = "- **[skill-name]**: [When to use it - one line]\n- **[skill-name]**: [When to use it - one line]"
    
    # Generate conventions placeholder
    conventions = "[Add 5-10 lines of critical project-wide conventions here]"
    
    # Create content
    content = AGENTS_MD_TEMPLATE.format(
        project_description=project_description,
        package_manager=package_manager,
        build_command=build_command,
        test_command=test_command,
        skill_references=skill_references,
        conventions=conventions
    )
    
    # Write file
    agents_md.write_text(content.strip() + "\n", encoding='utf-8')
    
    print(f"\n✅ Created AGENTS.md at {agents_md}")
    print(f"\nNext steps:")
    print(f"1. Edit AGENTS.md and replace placeholder text")
    print(f"2. Keep it under 150 lines")
    print(f"3. Run: python scripts/analyze_context.py")
    
    return True

def analyze_agents_md(project_path: Path) -> dict:
    """Analyze existing AGENTS.md and provide recommendations"""
    agents_md = project_path / "AGENTS.md"
    
    if not agents_md.exists():
        return {
            'exists': False,
            'message': 'AGENTS.md does not exist. Run without --analyze-only to create it.'
        }
    
    content = agents_md.read_text(encoding='utf-8')
    lines = content.split('\n')
    line_count = len([l for l in lines if l.strip()])  # Non-empty lines
    
    # Count instructions (rough heuristic: lines starting with -, *, or containing imperative verbs)
    instruction_indicators = ['-', '*', '1.', '2.', '3.', 'must', 'should', 'always', 'never', 'use ', 'do ', "don't"]
    instruction_count = sum(1 for line in lines if any(line.strip().lower().startswith(ind) or ind in line.lower() for ind in instruction_indicators))
    
    # Check for common anti-patterns
    issues = []
    suggestions = []
    
    if line_count > 200:
        issues.append(f"File is {line_count} lines (hard limit: 200). Extract content to skills.")
    elif line_count > 150:
        issues.append(f"File is {line_count} lines (target: 50-150). Consider extracting to skills.")
    
    if instruction_count > 200:
        issues.append(f"~{instruction_count} instructions detected (limit: ~150-200). Reduce by extracting to skills.")
    
    # Check for time-sensitive language
    time_sensitive = ['as of version', 'currently', 'the latest', 'recently']
    for i, line in enumerate(lines, 1):
        for phrase in time_sensitive:
            if phrase in line.lower():
                issues.append(f"Line {i}: Time-sensitive language '{phrase}' (avoid in AGENTS.md)")
    
    # Check for skill references
    has_skills_section = any('skill' in line.lower() for line in lines[:50])
    if not has_skills_section:
        suggestions.append("Add a 'Skills Available' section to help agents discover skills")
    
    # Check for package manager
    has_package_manager = any('package' in line.lower() or 'npm' in line.lower() or 'yarn' in line.lower() or 'pnpm' in line.lower() for line in lines)
    if not has_package_manager:
        suggestions.append("Specify package manager if not npm")
    
    return {
        'exists': True,
        'line_count': line_count,
        'instruction_count': instruction_count,
        'issues': issues,
        'suggestions': suggestions,
        'status': 'good' if line_count <= 150 and instruction_count <= 150 else 'needs_improvement'
    }

def main():
    parser = argparse.ArgumentParser(
        description='Initialize or analyze AGENTS.md',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Create AGENTS.md interactively
  python init_agents_md.py
  
  # Create in specific directory
  python init_agents_md.py --path /path/to/project
  
  # Analyze existing AGENTS.md
  python init_agents_md.py --analyze-only
  
  # Non-interactive creation
  python init_agents_md.py --no-interactive
        """
    )
    
    parser.add_argument(
        '--path',
        type=Path,
        default=Path.cwd(),
        help='Project directory (default: current directory)'
    )
    
    parser.add_argument(
        '--analyze-only',
        action='store_true',
        help='Only analyze existing AGENTS.md, do not create'
    )
    
    parser.add_argument(
        '--no-interactive',
        action='store_true',
        help='Create without interactive prompts'
    )
    
    args = parser.parse_args()
    
    project_path = args.path.resolve()
    
    if not project_path.exists():
        print(f"ERROR: Project path does not exist: {project_path}")
        return 1
    
    if args.analyze_only:
        analysis = analyze_agents_md(project_path)
        
        if not analysis['exists']:
            print(analysis['message'])
            return 1
        
        print(f"AGENTS.md Analysis\n{'=' * 50}")
        print(f"\nLine count: {analysis['line_count']}")
        print(f"Estimated instructions: ~{analysis['instruction_count']}")
        print(f"Status: {analysis['status'].upper()}")
        
        if analysis['issues']:
            print(f"\n❌ ISSUES:")
            for issue in analysis['issues']:
                print(f"  - {issue}")
        
        if analysis['suggestions']:
            print(f"\n💡 SUGGESTIONS:")
            for suggestion in analysis['suggestions']:
                print(f"  - {suggestion}")
        
        if not analysis['issues']:
            print(f"\n✅ AGENTS.md looks good!")
        
        return 0 if analysis['status'] == 'good' else 1
    else:
        interactive = not args.no_interactive
        success = create_agents_md(project_path, interactive=interactive)
        return 0 if success else 1

if __name__ == '__main__':
    sys.exit(main())
