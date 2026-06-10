#!/usr/bin/env python3
"""
Progressive Disclosure Context Analyzer

Analyzes AGENTS.md and skills together to provide insights on:
- Token usage and instruction budget
- Potential content to extract from AGENTS.md to skills
- Skill discovery gaps
- Optimization opportunities

Usage:
    python analyze_context.py
    python analyze_context.py --path /path/to/project
    python analyze_context.py --detailed
"""

import argparse
import re
import sys
from pathlib import Path
from typing import List, Dict, Tuple

def estimate_tokens(text: str) -> int:
    """Rough token estimation (1 token ≈ 4 characters)"""
    return len(text) // 4

def count_instructions(text: str) -> int:
    """Estimate number of instructions in text"""
    lines = text.split('\n')
    instruction_indicators = [
        '-', '*', '•',
        '1.', '2.', '3.', '4.', '5.',
        'must', 'should', 'always', 'never',
        'use ', 'do ', "don't", 'run ',
        'when ', 'if ', 'follow'
    ]
    
    count = 0
    for line in lines:
        line_lower = line.strip().lower()
        if any(line_lower.startswith(ind) or ind in line_lower for ind in instruction_indicators):
            count += 1
    
    return count

def analyze_agents_md(agents_md_path: Path) -> Dict:
    """Analyze AGENTS.md file"""
    if not agents_md_path.exists():
        return {
            'exists': False,
            'path': str(agents_md_path)
        }
    
    content = agents_md_path.read_text(encoding='utf-8')
    lines = content.split('\n')
    non_empty_lines = [l for l in lines if l.strip()]
    
    # Extract sections
    sections = {}
    current_section = None
    current_content = []
    
    for line in lines:
        if line.startswith('# ') or line.startswith('## '):
            if current_section:
                sections[current_section] = '\n'.join(current_content)
            current_section = line.strip('# ').strip()
            current_content = []
        else:
            current_content.append(line)
    
    if current_section:
        sections[current_section] = '\n'.join(current_content)
    
    # Analyze each section
    section_analysis = {}
    for section_name, section_content in sections.items():
        section_analysis[section_name] = {
            'lines': len([l for l in section_content.split('\n') if l.strip()]),
            'tokens': estimate_tokens(section_content),
            'instructions': count_instructions(section_content)
        }
    
    # Find extractable sections (>20 lines or >10 instructions)
    extractable = []
    for section_name, analysis in section_analysis.items():
        if analysis['lines'] > 20 or analysis['instructions'] > 10:
            if section_name not in ['Project Overview', 'Skills Available', 'Development Setup']:
                extractable.append({
                    'section': section_name,
                    'lines': analysis['lines'],
                    'instructions': analysis['instructions'],
                    'reason': f"{analysis['lines']} lines, {analysis['instructions']} instructions"
                })
    
    return {
        'exists': True,
        'path': str(agents_md_path),
        'total_lines': len(non_empty_lines),
        'total_tokens': estimate_tokens(content),
        'total_instructions': count_instructions(content),
        'sections': section_analysis,
        'extractable_sections': extractable
    }

def scan_skills(skills_dir: Path) -> List[Dict]:
    """Scan and analyze available skills"""
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
            
            # Count lines and tokens
            lines = content.split('\n')
            non_empty = [l for l in lines if l.strip()]
            
            skills.append({
                'name': name or skill_dir.name,
                'directory': skill_dir.name,
                'description': description,
                'lines': len(non_empty),
                'tokens': estimate_tokens(content),
                'has_references': (skill_dir / "reference").exists(),
                'has_scripts': (skill_dir / "scripts").exists()
            })
        except Exception as e:
            print(f"Warning: Error analyzing {skill_dir.name}: {e}", file=sys.stderr)
    
    return skills

def find_discovery_gaps(agents_md_content: str, skills: List[Dict]) -> List[Dict]:
    """Find skills that aren't referenced in AGENTS.md"""
    gaps = []
    
    agents_lower = agents_md_content.lower()
    
    for skill in skills:
        # Check if skill name appears in AGENTS.md
        skill_name = skill['name'].lower()
        skill_dir = skill['directory'].lower()
        
        if skill_name not in agents_lower and skill_dir not in agents_lower:
            gaps.append({
                'skill': skill['name'],
                'directory': skill['directory'],
                'description': skill['description'],
                'reason': 'Not referenced in AGENTS.md'
            })
    
    return gaps

def main():
    parser = argparse.ArgumentParser(
        description='Analyze AGENTS.md and skills for progressive disclosure optimization',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Analyze current project
  python analyze_context.py
  
  # Analyze specific project
  python analyze_context.py --path /path/to/project
  
  # Detailed output with section breakdown
  python analyze_context.py --detailed
        """
    )
    
    parser.add_argument(
        '--path',
        type=Path,
        default=Path.cwd(),
        help='Project directory (default: current directory)'
    )
    
    parser.add_argument(
        '--detailed',
        action='store_true',
        help='Show detailed section-by-section analysis'
    )
    
    args = parser.parse_args()
    
    project_path = args.path.resolve()
    agents_md_path = project_path / "AGENTS.md"
    skills_dir = project_path / ".windsurf" / "skills"
    
    print(f"Progressive Disclosure Analysis")
    print(f"{'=' * 60}\n")
    print(f"Project: {project_path}\n")
    
    # Analyze AGENTS.md
    print(f"📄 AGENTS.md Analysis")
    print(f"{'-' * 60}")
    
    agents_analysis = analyze_agents_md(agents_md_path)
    
    if not agents_analysis['exists']:
        print(f"❌ AGENTS.md not found at {agents_analysis['path']}")
        print(f"\n💡 Run: python scripts/init_agents_md.py")
    else:
        print(f"Location: {agents_analysis['path']}")
        print(f"Lines: {agents_analysis['total_lines']}")
        print(f"Tokens: ~{agents_analysis['total_tokens']}")
        print(f"Instructions: ~{agents_analysis['total_instructions']}")
        
        # Status indicator
        if agents_analysis['total_lines'] <= 150 and agents_analysis['total_instructions'] <= 150:
            status = "✅ GOOD"
        elif agents_analysis['total_lines'] <= 200:
            status = "⚠️  NEEDS IMPROVEMENT"
        else:
            status = "❌ TOO LARGE"
        
        print(f"Status: {status}")
        
        # Budget analysis
        print(f"\n📊 Instruction Budget:")
        budget_used = (agents_analysis['total_instructions'] / 150) * 100
        print(f"  Used: {agents_analysis['total_instructions']}/150 ({budget_used:.1f}%)")
        
        if budget_used > 100:
            print(f"  ❌ Over budget by {agents_analysis['total_instructions'] - 150} instructions")
        elif budget_used > 80:
            print(f"  ⚠️  Near capacity - consider extracting to skills")
        else:
            print(f"  ✅ Within budget")
        
        # Extractable sections
        if agents_analysis['extractable_sections']:
            print(f"\n📤 Extractable Sections:")
            for section in agents_analysis['extractable_sections']:
                print(f"  - {section['section']}: {section['reason']}")
                print(f"    → Suggest: python scripts/extract_to_skill.py --section \"{section['section']}\"")
        
        # Detailed section breakdown
        if args.detailed and agents_analysis['sections']:
            print(f"\n📋 Section Breakdown:")
            for section_name, section_data in agents_analysis['sections'].items():
                print(f"  {section_name}:")
                print(f"    Lines: {section_data['lines']}")
                print(f"    Tokens: ~{section_data['tokens']}")
                print(f"    Instructions: ~{section_data['instructions']}")
    
    # Analyze skills
    print(f"\n\n🔧 Skills Analysis")
    print(f"{'-' * 60}")
    
    skills = scan_skills(skills_dir)
    
    if not skills:
        print(f"No skills found in {skills_dir}")
        print(f"\n💡 Create your first skill:")
        print(f"   python scripts/create_skill_template.py --name my-skill --scope project")
    else:
        print(f"Found {len(skills)} skill(s):\n")
        
        for skill in skills:
            print(f"  📦 {skill['name']}")
            if skill['description']:
                print(f"     {skill['description'][:80]}...")
            print(f"     Lines: {skill['lines']} | Tokens: ~{skill['tokens']}")
            
            features = []
            if skill['has_references']:
                features.append("references")
            if skill['has_scripts']:
                features.append("scripts")
            if features:
                print(f"     Features: {', '.join(features)}")
            print()
    
    # Discovery gaps
    if agents_analysis['exists'] and skills:
        gaps = find_discovery_gaps(
            agents_md_path.read_text(encoding='utf-8'),
            skills
        )
        
        if gaps:
            print(f"\n🔍 Skill Discovery Gaps")
            print(f"{'-' * 60}")
            print(f"These skills exist but aren't referenced in AGENTS.md:\n")
            
            for gap in gaps:
                print(f"  - {gap['skill']} ({gap['directory']})")
                if gap['description']:
                    print(f"    {gap['description'][:80]}...")
            
            print(f"\n💡 Run: python scripts/update_skill_references.py")
    
    # Summary recommendations
    print(f"\n\n💡 Recommendations")
    print(f"{'-' * 60}")
    
    recommendations = []
    
    if not agents_analysis['exists']:
        recommendations.append("Create AGENTS.md: python scripts/init_agents_md.py")
    elif agents_analysis['total_lines'] > 150:
        recommendations.append(f"Extract sections from AGENTS.md to skills (currently {agents_analysis['total_lines']} lines)")
    
    if agents_analysis['exists'] and agents_analysis['extractable_sections']:
        recommendations.append(f"Extract {len(agents_analysis['extractable_sections'])} section(s) to skills")
    
    if gaps:
        recommendations.append(f"Add {len(gaps)} skill reference(s) to AGENTS.md")
    
    if not skills:
        recommendations.append("Create skills for domain-specific guidance")
    
    if not recommendations:
        recommendations.append("✅ Setup looks good! Continue monitoring as project grows.")
    
    for i, rec in enumerate(recommendations, 1):
        print(f"{i}. {rec}")
    
    print()
    
    # Return exit code based on status
    if agents_analysis['exists']:
        if agents_analysis['total_lines'] > 200:
            return 1
        elif agents_analysis['total_instructions'] > 200:
            return 1
    
    return 0

if __name__ == '__main__':
    sys.exit(main())
