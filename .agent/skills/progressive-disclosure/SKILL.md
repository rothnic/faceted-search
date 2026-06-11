---
name: progressive-disclosure
description: Manage AGENTS.md and skills using progressive disclosure to optimize AI agent context. Use when setting up a project, creating AGENTS.md, managing skills, or optimizing token usage across both files.
---

# Progressive Disclosure for AGENTS.md and Skills

Optimize AI agent context using progressive disclosure principles. Manage AGENTS.md as a minimal entry point that references skills for detailed guidance, keeping the instruction budget efficient while maintaining capability.

## When to Use This Skill

- Setting up AGENTS.md for a new or existing project
- Creating semantic skill references that help agents discover skills
- Refactoring bloated AGENTS.md files (>150 instructions)
- Creating skills to extract content from AGENTS.md
- Optimizing the relationship between AGENTS.md and skills
- Managing skill discovery and loading patterns
- Validating AGENTS.md and skill structure

## Core Principles

### The Instruction Budget Problem

**AGENTS.md loads on EVERY turn**. Frontier LLMs can follow ~150-200 instructions consistently. This creates hard constraints:
- AGENTS.md tokens compete with conversation history
- Every instruction must justify its presence
- Bloat reduces agent effectiveness

**Skills load on demand**. They provide progressive disclosure:
- Agents see only name + description at startup
- Full content loads when relevant
- Detail doesn't pollute context unnecessarily

### The Golden Rule

**AGENTS.md** = Minimal entry point + skill references  
**Skills** = Detailed guidance loaded when needed

### Progressive Disclosure Hierarchy

```
AGENTS.md (50-150 lines)
├── Project essentials
├── Skill references
└── Critical conventions

Skills (loaded on demand)
├── Domain-specific patterns
├── Detailed workflows
└── Complex guidelines
```

## Quick Start: Setting Up Progressive Disclosure

### Step 1: Check for AGENTS.md

Run the initialization script:
```bash
python scripts/init_agents_md.py
```

**If AGENTS.md doesn't exist**: Script creates a minimal template  
**If AGENTS.md exists**: Script analyzes and suggests improvements

### Step 2: Analyze Current State

Run the analyzer to understand what you have:
```bash
python scripts/analyze_context.py
```

This reports:
- AGENTS.md instruction count and token usage
- Available skills and their descriptions
- Potential extractions (content that should move to skills)
- Skill discovery gaps

### Step 3: Extract to Skills

If AGENTS.md is bloated (>150 instructions):
```bash
python scripts/extract_to_skill.py --section "Section Name"
```

This:
- Creates new skill with extracted content
- Updates AGENTS.md with skill reference
- Maintains semantic discovery hints

### Step 4: Manage Skill References

Keep skill references discoverable in AGENTS.md:
```bash
python scripts/update_skill_references.py
```

Generates a skills section in AGENTS.md that helps agents know:
- What skills exist
- When to load each skill
- How important each skill is to follow

### Step 5: Validate the Setup

**Validate progressive disclosure structure:**
```bash
python scripts/validate_progressive_disclosure.py
```

Checks:
- AGENTS.MD is under instruction budget
- Skills are properly referenced
- No duplication between AGENTS.md and skills
- Skill descriptions are discoverable

**Validate markdown links:**
```bash
python scripts/validate_markdown_links.py path/to/skill/
```

Checks:
- Internal file links are not broken
- Referenced files exist
- Anchor links point to valid headings
- No dead cross-references

## AGENTS.md Structure and Best Practices

### What Belongs in AGENTS.md

**The Minimal Three**:
1. **One-sentence project description** (acts as role-based prompt)
2. **Package manager** (if not npm/default)
3. **Non-standard build commands** (if not obvious)

**Optional but recommended**:
- Skill references section (helps with discovery)
- Critical project-wide conventions (5-10 lines max)

**What does NOT belong**:
- ❌ Language-specific conventions (extract to skills)
- ❌ Detailed workflows (extract to skills)  
- ❌ File structure documentation (agents can navigate)
- ❌ Tool usage guides (link to external docs or skills)
- ❌ Testing strategies (extract to skills)
- ❌ Time-sensitive information (versions, "current state")

### AGENTS.md Template

```markdown
# Project Overview

[One-sentence description of what this project does and its purpose]

## Development Setup

- Package manager: [pnpm/yarn/npm]
- Build: `[build command if non-standard]`
- Test: `[test command if non-standard]`

## Skills Available

This project uses skills for detailed guidance. Load the appropriate skill when working in these areas:

- **[skill-name]**: [When to use it - one line]
- **[skill-name]**: [When to use it - one line]
- **[skill-name]**: [When to use it - one line]

## Critical Conventions

[Only include 5-10 lines of project-wide conventions that apply everywhere]
```

### Skill Reference Patterns in AGENTS.md

**Good** - Semantic hints that help with discovery:
```markdown
## Skills Available

- **api-design**: When creating or modifying API endpoints
- **database-patterns**: When working with database queries, schemas, or migrations  
- **testing-strategy**: When writing tests or debugging test failures
- **deployment**: When deploying or troubleshooting production issues
```

**Better** - Include importance/priority:
```markdown
## Skills Available (Load as Needed)

**Critical** (always follow):
- **security-patterns**: When handling authentication, authorization, or sensitive data

**Important** (follow for these domains):
- **api-design**: When creating or modifying API endpoints
- **database-patterns**: When working with database code

**Helpful** (reference for guidance):
- **code-style**: For formatting and style preferences
- **troubleshooting**: When debugging issues
```

### Managing AGENTS.md Length

**Target**: 50-150 lines total  
**Hard limit**: 200 lines

If AGENTS.md exceeds these:
1. Run `python scripts/analyze_context.py` to identify candidates for extraction
2. Use `python scripts/extract_to_skill.py` to move content to skills
3. Keep only project-essential information
4. Reference skills instead of duplicating content

## Skill Structure Guidelines

### Frontmatter Requirements

```yaml
---
name: skill-name-here        # Max 64 chars, lowercase, hyphens only
description: Clear description including what and when (max 1024 chars)
---
```

**Name rules**:
- Lowercase letters, numbers, hyphens only
- No XML tags or reserved words
- Should match directory name
- Pattern: `^[a-z0-9]+(-[a-z0-9]+)*$`

**Description rules**:
- Include WHAT the skill does
- Include WHEN to use it
- Include KEY TERMS for discoverability
- Make it specific, not generic

### Content Organization

**SKILL.md** (main file):
- Overview and when to use
- Core workflows and instructions
- Pointers to reference files
- Script execution instructions

**reference/** directory:
- Detailed API documentation
- Extended examples
- Troubleshooting guides
- Background information

**scripts/** directory:
- Validation scripts
- Generation helpers
- Automation tools

### Reference File Patterns

Keep references **one level deep**:
```markdown
# Good - SKILL.md references reference files
See reference/api-guide.md for authentication patterns

# Bad - reference files referencing other reference files
See ../other-reference.md for more details
```

For longer reference files, use table of contents:
```markdown
# Reference File

## Contents
- Section 1 (line 50)
- Section 2 (line 150)
- Section 3 (line 300)

## Section 1
...
```

## Writing Effective Descriptions

The description is critical for skill discovery. Include:

1. **Domain keywords**: Technologies, frameworks, concepts
2. **Action verbs**: "analyze", "generate", "validate", "transform"
3. **Trigger conditions**: "when writing React", "for SQL queries"

### Examples

✅ **Good**:
- "Validate and format Python code using black, isort, and mypy. Use when writing or reviewing Python files in this project."
- "Generate Next.js API routes following RESTful conventions and TypeScript best practices. Use when creating new API endpoints."

❌ **Bad**:
- "Code helper" (too vague)
- "This skill helps with databases" (no trigger, no specifics)
- "Use this for everything related to testing" (too broad)

## Workflow Patterns

### Simple Task Pattern
For straightforward single-step operations:
```markdown
## Task Name

Do X by running Y:
```bash
command here
```
```

### Multi-Step Workflow Pattern
For complex sequential operations:
```markdown
## Workflow Name

Follow these steps in order:

1. **Validate input**: Run `scripts/validate.py`
2. **Process data**: Apply transformations
3. **Verify output**: Check results meet criteria
4. **Commit changes**: Document what changed
```

### Plan-Validate-Execute Pattern
For high-stakes operations:
```markdown
## Critical Operation

Use the plan-validate-execute pattern:

1. **Generate plan**: Create `plan.json` with proposed changes
2. **Validate plan**: Run `scripts/validate_plan.py plan.json`
3. **Review validation**: Check for errors or warnings
4. **Execute**: Apply changes only if validation passes
5. **Verify**: Confirm results match plan
```

### Conditional Workflow Pattern
When there are clear decision points:
```markdown
## Task With Variations

**If** condition A:
- Do workflow X

**If** condition B:
- Do workflow Y

**Otherwise**:
- Default workflow Z
```

## Managing Scripts

Scripts make skills more token-efficient and deterministic.

### When to Use Scripts

✅ **Good use cases**:
- Validation logic (checking structure, formats)
- Complex calculations or transformations
- File system operations
- Repetitive multi-step processes

❌ **Poor use cases**:
- Simple one-line operations
- Logic that needs to adapt to context
- Operations requiring LLM reasoning

### Script Documentation

In SKILL.md, document scripts clearly:
```markdown
## Validation Script

Run validation before applying changes:
```bash
python scripts/validate_config.py --input config.json --strict
```

The script checks:
- Required fields are present
- Values are within allowed ranges
- No conflicting settings

Exit codes:
- 0: Validation passed
- 1: Validation failed (see error output)
- 2: Invalid arguments
```

### Available Validation Scripts

**validate_progressive_disclosure.py** - Validates AGENTS.md and skill structure
- Checks instruction budget compliance
- Verifies skill references are valid
- Detects duplication between AGENTS.md and skills

**validate_skill.py** - Validates individual SKILL.md files
- Checks frontmatter format
- Validates reference links
- Detects anti-patterns and quality issues

**validate_markdown_links.py** - Validates markdown link integrity
- Checks all internal file links
- Validates anchor references (#heading)
- Detects broken cross-references
- Suggests similar anchors for typos

Usage:
```bash
# Validate single skill directory
python scripts/validate_markdown_links.py .windsurf/skills/my-skill/

# Validate with anchor checking
python scripts/validate_markdown_links.py --check-anchors docs/

# Validate single file
python scripts/validate_markdown_links.py README.md
```

## Content Guidelines

### Altitude: Not Too High, Not Too Low

Balance between rigid rules and vague guidance:

**Too restrictive** (brittle):
```markdown
If file extension is .tsx:
    import React from 'react'
    use function components
    add PropTypes
If file extension is .ts:
    ...
```

**Too vague**:
```markdown
Write good code following best practices.
```

**Just right**:
```markdown
For React components:
- Use function components with hooks
- Export component as default
- Place types in same file
- Follow existing naming patterns in project
```

### Include Guardrails

State what NOT to do:
```markdown
## Limitations and Constraints

- Do not modify files in `.config/system/`
- Cannot run operations requiring sudo/admin privileges  
- Database queries timeout after 30 seconds
- File uploads limited to 10MB
```

### Use Consistent Terminology

Pick one term per concept and use it throughout:
- "workspace" not "workspace/project/environment"
- "repository" not "repository/repo/codebase"
- Match your product's vocabulary

### Avoid Time-Sensitive Information

Don't include:
- "As of version X.Y.Z..."
- "Currently supports..."
- "The latest feature..."

Instead:
- Reference external docs for versioned info
- Use feature detection in scripts
- Document timeless patterns

## Testing and Validation

### Build Evaluations First

Before writing the skill, create test cases:
1. 3+ realistic scenarios
2. Expected behaviors for each
3. Edge cases and error conditions

### Test Across Model Tiers

Test with multiple models:
- **Haiku**: Fast, cost-effective (does it work?)
- **Sonnet**: Balanced (does it work well?)
- **Opus**: Most capable (does it work optimally?)

### Iteration Process

1. Start with minimal SKILL.md (just core workflow)
2. Test with real agent interactions
3. Note where agent gets confused or makes mistakes
4. Add only what's needed to fix failure modes
5. Remove unused content
6. Repeat

## Project vs Shared Skills

See `reference/project-vs-shared-skills.md` for comprehensive guide.

### Quick Decision Tree

**Project-specific skills** (store in project repo):
- Project architecture patterns
- Codebase-specific conventions
- Local tool configurations
- Project-unique workflows

**Shared across your projects** (store in user config):
- Personal coding style preferences
- Language best practices you always follow
- Tool usage patterns you reuse
- General-purpose utilities

**Team-shared skills** (store in team repo):
- Team conventions and standards
- Shared toolchain configurations
- Common workflow patterns
- Organization-wide best practices

## Team Skill Management

For teams sharing skills:

### Version Control
- Store skills in Git
- Use semantic versioning for major changes
- Tag releases that agents depend on
- Document breaking changes

### Skill Discovery
- Maintain a skills catalog (README or index)
- Use consistent naming conventions
- Include description in catalog
- Link to documentation

### Review Process
- Treat skill changes like code changes
- Test before merging
- Document what changed and why
- Consider impact on existing agents

### Skill Dependencies
If skills reference each other:
- Document dependencies explicitly
- Avoid circular dependencies
- Version pin if needed
- Test the full stack together

## Common Anti-Patterns to Avoid

❌ **Don't**: Duplicate external documentation
✅ **Do**: Reference official docs with context

❌ **Don't**: Document file paths and structure
✅ **Do**: Describe capabilities and how to find things

❌ **Don't**: Include verbose explanations
✅ **Do**: Use concise, direct language

❌ **Don't**: Nest references deeply
✅ **Do**: Keep references one level deep

❌ **Don't**: Use Windows-style paths
✅ **Do**: Use forward slashes consistently

❌ **Don't**: Offer too many options without guidance
✅ **Do**: Provide clear decision criteria

❌ **Don't**: Assume packages are installed
✅ **Do**: List required dependencies explicitly

❌ **Don't**: Auto-generate skills
✅ **Do**: Write them thoughtfully with real use cases

## Checklist for Quality Skills

Use this checklist before considering a skill complete:

### Core Quality
- [ ] Description includes what, when, and key terms
- [ ] SKILL.md is under 500 lines
- [ ] Additional details in reference files
- [ ] No time-sensitive information
- [ ] Consistent terminology throughout
- [ ] Examples are concrete, not abstract
- [ ] Progressive disclosure used appropriately
- [ ] Workflows have clear steps

### Scripts and Code
- [ ] Scripts solve problems (not punted to agent)
- [ ] Error handling is explicit
- [ ] Required packages listed
- [ ] Scripts documented with usage examples
- [ ] All paths use forward slashes

### Testing
- [ ] At least 3 evaluation scenarios created
- [ ] Tested with multiple model tiers
- [ ] Tested with real usage patterns
- [ ] Team feedback incorporated (if applicable)

### Structure
- [ ] Frontmatter follows requirements
- [ ] Directory structure is clear
- [ ] Reference files have clear purposes
- [ ] No deeply nested references

## Getting Help

For detailed information on specific topics:

- **Progressive disclosure patterns**: `reference/progressive-disclosure-guide.md`
- **Project vs shared skills**: `reference/project-vs-shared-skills.md`
- **Testing strategies**: `reference/testing-guide.md`
- **Advanced patterns**: `reference/advanced-patterns.md`

## Quick Reference: File Limits

- **name field**: Max 64 characters
- **description field**: Max 1024 characters
- **SKILL.md body**: Target <500 lines (soft limit)
- **Reference files**: No hard limit (loaded on demand)
- **Scripts**: No limit (executed, not loaded into context)
