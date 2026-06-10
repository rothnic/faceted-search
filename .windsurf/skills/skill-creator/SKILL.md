---
name: skill-creator
description: Create well-structured AI agent skills following progressive disclosure best practices. Use when authoring new skills, refactoring existing skills, or deciding between project-specific and shared skill management strategies.
---

# Skill Creator

Create effective AI agent skills using progressive disclosure principles and best practices from Vercel, Anthropic, and the broader AI agent ecosystem.

## When to Use This Skill

- Creating a new skill from scratch
- Refactoring an existing skill to improve token efficiency
- Deciding whether a skill should be project-specific or shared across projects
- Validating skill structure and content quality
- Setting up skill management workflows for teams

## Core Principles

### 1. Progressive Disclosure First
Skills should reveal complexity gradually:
- **SKILL.md**: Core instructions only (target <500 lines)
- **reference/**: Detailed documentation loaded on demand
- **scripts/**: Executable code that doesn't consume context until run

### 2. Minimal Viable Context
Default assumption: The model is already smart. Only include what the agent cannot infer:
- Specific domain knowledge
- Non-obvious workflows
- Tool usage patterns
- Guardrails and constraints

### 3. Token Efficiency
Every token in SKILL.md competes with conversation history and task context. Challenge each line:
- "Does the agent really need this explanation?"
- "Can this be moved to a reference file?"
- "Would a script be more token-efficient?"

## Quick Start Workflow

### Step 1: Determine Skill Scope

Ask these questions:
- **Domain**: What specific area does this skill cover?
- **Trigger**: When should an agent load this skill?
- **Boundaries**: What is explicitly out of scope?

Document answers in 1-2 sentences for the description field.

### Step 2: Choose Storage Location

See `reference/project-vs-shared-skills.md` for detailed decision tree.

**Quick guidance**:
- **Project-specific**: `.windsurf/skills/` in project repo
- **Shared across projects**: Central skills repository or user-level config
- **Team-shared**: Dedicated skills repo with version control

### Step 3: Create Skill Structure

Run the template generator:
```bash
python scripts/create_skill_template.py --name your-skill-name --scope [project|shared|team]
```

This creates:
```
your-skill-name/
├── SKILL.md
├── scripts/
│   └── .gitkeep
└── reference/
    └── .gitkeep
```

### Step 4: Write Core Content

Follow this structure in SKILL.md:

```markdown
---
name: your-skill-name
description: What it does and when to use it (max 1024 chars)
---

# Skill Name

Brief overview (2-3 sentences)

## When to Use This Skill
- Specific trigger scenario 1
- Specific trigger scenario 2

## Core Instructions
Main workflow steps

## Reference Documentation
For detailed information, see:
- reference/detailed-guide.md
- reference/examples.md
```

### Step 5: Validate

Run the validation script:
```bash
python scripts/validate_skill.py path/to/your-skill/SKILL.md
```

Checks:
- Frontmatter structure and field requirements
- SKILL.md line count (<500 recommended)
- Reference file structure
- Script executability
- Common anti-patterns

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
