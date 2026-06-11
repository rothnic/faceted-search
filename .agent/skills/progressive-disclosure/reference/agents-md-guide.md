# AGENTS.md: The Complete Guide

A comprehensive guide to managing AGENTS.md as the minimal entry point for progressive disclosure.

## Table of Contents
- Philosophy and Purpose (line 20)
- The Instruction Budget (line 55)
- What Belongs in AGENTS.md (line 95)
- AGENTS.md Structure (line 145)
- Skill Reference Patterns (line 210)
- Common Mistakes (line 280)
- Migration from Bloated AGENTS.md (line 340)
- Nested AGENTS.md in Monorepos (line 395)

## Philosophy and Purpose

### AGENTS.md is Not Documentation

AGENTS.md is **not** documentation for humans. It's configuration for AI agents.

**Think of it as**:
- A router that directs agents to detailed guidance (skills)
- A minimal context layer that loads on every turn
- Project essentials only

**Not as**:
- A comprehensive guide
- Detailed workflows
- Language-specific conventions
- Tool documentation

### The AGENTS.md Role in Progressive Disclosure

```
User Request
     ↓
AGENTS.md (loaded always)
├─ Recognizes project context
├─ Sees available skills
└─ Routes to appropriate skill
     ↓
Skill (loaded on demand)
├─ Detailed workflows
├─ Domain-specific guidance
└─ References for deep dives
```

**AGENTS.md answers**: "What is this project and what skills are available?"  
**Skills answer**: "How do I actually do X in this project?"

### Why Minimal Matters

Every token in AGENTS.md:
- Loads on **every single turn**
- Competes with conversation history
- Depletes the instruction budget
- Reduces agent focus

A 200-line AGENTS.md on every turn = Less capacity for:
- Your actual request
- Tool usage
- Reasoning
- File context

## The Instruction Budget

### The Hard Limit

Research from AI Hero and Vercel shows:
- **Frontier LLMs**: Can follow ~150-200 instructions consistently
- **Extended thinking models**: Can handle more, but with degradation
- **Smaller models**: Fewer instructions (100-150)

**Instruction** = Actionable directive (must, should, always, never, use, do, etc.)

### What Counts as an Instruction

```markdown
✅ Counts as 1 instruction:
- Use pnpm for package management

✅ Counts as 1 instruction:
- Always run tests before committing

❌ Doesn't count (description):
This project is a web application

❌ Doesn't count (statement):
The database is PostgreSQL
```

### Budget Allocation Strategy

For a 150-instruction budget:

**AGENTS.md** (30-50 instructions):
- Project setup: 5-10
- Critical conventions: 10-15
- Skill references: 10-20
- Emergency info: 5

**Skills** (100-120 instructions total, loaded on demand):
- Per-skill varies based on complexity
- Only relevant skills load per task
- Detail doesn't pollute base context

### Measuring Your Budget

Use the analyzer:
```bash
python scripts/analyze_context.py
```

Outputs:
```
Instruction Budget:
  Used: 145/150 (96.7%)
  ⚠️ Near capacity
```

If over budget → Extract to skills

## What Belongs in AGENTS.md

### The Minimal Three (Always Include)

**1. One-sentence project description**
```markdown
# Project Overview

A React-based e-commerce platform for customizable merchandise.
```

Acts as a role-based prompt. Grounds the agent in project purpose.

**2. Package manager (if not default)**
```markdown
## Development Setup

- Package manager: pnpm
```

Prevents "npm install" when you use pnpm. Simple but critical.

**3. Non-standard commands**
```markdown
- Build: `pnpm build:all`
- Test: `pnpm test:integration`
```

Only if different from standard conventions. If it's just `npm test`, omit it.

### Optional but Recommended

**Skill references** (10-20 lines):
```markdown
## Skills Available

- **api-design**: When creating or modifying API endpoints
- **database-patterns**: When working with database code
- **testing-strategy**: When writing or debugging tests
```

Helps agent discovery. Semantic hints improve loading accuracy.

**Critical project-wide conventions** (5-10 lines max):
```markdown
## Critical Conventions

- All API routes must include authentication middleware
- Database migrations require team review before merging
- Feature flags required for new user-facing features
```

Only include conventions that:
- Apply everywhere in the codebase
- Are non-obvious
- Cause problems if violated

### What Does NOT Belong

| Content Type | Why Not | Solution |
|--------------|---------|----------|
| Language-specific style | Not project-unique | Extract to skill or link external guide |
| Detailed workflows | Too much context | Extract to skill |
| File structure docs | Agents can navigate | Describe capabilities, not paths |
| Tool usage guides | Duplicates official docs | Link to docs or create skill |
| Testing strategies | Domain-specific detail | Extract to testing skill |
| Deployment steps | Multi-step workflow | Extract to deployment skill |
| Time-sensitive info | Goes stale quickly | Reference external versioned docs |
| Examples | Token-heavy | Put in skill reference files |

## AGENTS.md Structure

### Recommended Template

```markdown
# Project Overview

[One-sentence description]

## Development Setup

- Package manager: [pnpm/yarn/npm if not npm]
- Build: `[command if non-standard]`
- Test: `[command if non-standard]`

## Skills Available

This project uses skills for detailed guidance. Load the appropriate skill:

- **[skill-name]**: When [trigger condition]
- **[skill-name]**: When [trigger condition]

## Critical Conventions

[5-10 lines of project-wide conventions that apply everywhere]

[Optional: Additional sections if truly essential]
```

### Section Order

1. **Project Overview** - Context first
2. **Development Setup** - How to run things
3. **Skills Available** - Where to find detailed guidance
4. **Critical Conventions** - Must-knows

Keep this order. It flows logically from "what" → "how" → "where" → "watch out for".

### Length Guidelines

| Metric | Target | Warning | Hard Limit |
|--------|--------|---------|------------|
| Lines | 50-100 | 150 | 200 |
| Instructions | 30-80 | 150 | 200 |
| Sections | 3-5 | 7 | 10 |

Over target → Extract sections to skills

## Skill Reference Patterns

### Basic Pattern (Good)

```markdown
## Skills Available

- **api-design**: When creating or modifying API endpoints
- **database-patterns**: When working with database queries or schemas
- **testing-strategy**: When writing tests or debugging test failures
```

**Why it works**:
- Clear skill names
- Semantic trigger hints ("when creating...")
- Scannable format

### Priority Pattern (Better)

```markdown
## Skills Available

**Critical** (always follow):
- **security-patterns**: When handling auth, authorization, or sensitive data

**Important** (follow for these domains):
- **api-design**: When creating or modifying API endpoints
- **database-patterns**: When working with database code

**Helpful** (reference for guidance):
- **code-style**: For formatting and style preferences
```

**Why it works**:
- Priority levels guide agent decision-making
- Critical skills always loaded
- Important skills loaded for domain work
- Helpful skills referenced as needed

### Discovery Optimization

From Vercel research on skill loading:

**Good triggers** (semantic, specific):
- "When writing React components"
- "For database migrations"
- "When deploying to production"

**Poor triggers** (vague, generic):
- "For coding"
- "General guidelines"
- "When working"

**Best practice**: Match triggers to actual task language users will use.

### Auto-Generation

Use the updater script:
```bash
python scripts/update_skill_references.py --priority
```

Scans skills, extracts descriptions, generates semantic references.

## Common Mistakes

### Mistake 1: AGENTS.md as Documentation Site

```markdown
❌ BAD (200+ lines):
# Project

## Architecture
[50 lines about architecture]

## API Design
[60 lines of API patterns]

## Database
[40 lines about schema]

## Testing
[50 lines of testing approach]
```

**Why bad**: All this loads every turn, even for simple tasks.

**Fix**: Extract to skills, keep only references in AGENTS.md.

### Mistake 2: Documenting File Paths

```markdown
❌ BAD:
## Project Structure

- `src/api/` - API routes
- `src/components/` - React components  
- `src/utils/` - Utility functions
- `tests/` - Test files
```

**Why bad**:
- Agents can navigate directories
- Paths change, documentation goes stale
- Wastes instruction budget

**Fix**: Remove. Agents discover structure through navigation.

### Mistake 3: Language Convention Dumps

```markdown
❌ BAD:
## TypeScript Conventions

- Use interfaces over types
- Prefer const over let
- Always use strict null checks
- Export types from index files
- Use named exports for components
[30 more lines...]
```

**Why bad**: Language-specific, not project-specific.

**Fix**: Extract to `typescript-style` skill or link to external guide.

### Mistake 4: Time-Sensitive Information

```markdown
❌ BAD:
- Currently using Next.js 14
- As of version 2.0, we support...
- The latest API changes require...
```

**Why bad**: Goes stale immediately, maintenance burden.

**Fix**: Reference external versioned docs or use feature detection in scripts.

### Mistake 5: No Skill References

```markdown
❌ BAD:
AGENTS.md exists but doesn't mention skills at all.
```

**Why bad**: Agents don't know skills exist, won't load them.

**Fix**: Add Skills Available section with clear triggers.

### Mistake 6: Duplicating Skill Content

```markdown
❌ BAD:
AGENTS.md has detailed testing guide.
testing-strategy skill has same guide.
```

**Why bad**: Content duplication wastes tokens, maintenance burden.

**Fix**: Pick one (skill), reference from AGENTS.md.

## Migration from Bloated AGENTS.md

### Step 1: Analyze

```bash
python scripts/analyze_context.py
```

Outputs extractable sections:
```
📤 Extractable Sections:
  - Testing Strategy: 45 lines, 23 instructions
  - API Patterns: 38 lines, 19 instructions
  - Database Schema: 52 lines, 15 instructions
```

### Step 2: Extract Largest Sections

```bash
python scripts/extract_to_skill.py --section "Testing Strategy"
```

Creates:
- `.windsurf/skills/testing-strategy/SKILL.md`
- Updates AGENTS.md with skill reference

### Step 3: Update References

```bash
python scripts/update_skill_references.py --priority
```

Generates semantic skill references in AGENTS.md.

### Step 4: Validate

```bash
python scripts/validate_progressive_disclosure.py
```

Checks:
- AGENTS.md under budget
- Skills properly referenced
- No duplication

### Step 5: Iterate

Repeat extraction until AGENTS.md is <150 lines, <150 instructions.

### Migration Priority

Extract in this order:
1. **Large sections** (>40 lines) - Biggest wins
2. **Detailed workflows** - Multi-step processes
3. **Language-specific conventions** - Not project-unique
4. **Tool guides** - Can link external docs
5. **Examples and templates** - Token-heavy

Keep until last:
- Project description
- Package manager
- Build commands
- Critical conventions

## Nested AGENTS.md in Monorepos

### The Pattern

```
monorepo/
├── AGENTS.md                    # Root level
├── packages/
│   ├── api/
│   │   └── AGENTS.md           # Package level
│   └── web/
│       └── AGENTS.md           # Package level
└── .windsurf/skills/           # Shared skills
```

### Root AGENTS.md (Monorepo)

```markdown
# Monorepo Overview

This monorepo contains web services and CLI tools.

## Development Setup

- Package manager: pnpm workspaces
- Build all: `pnpm build:all`
- Test all: `pnpm test:all`

## Monorepo Structure

- `packages/api/` - REST API service (see packages/api/AGENTS.md)
- `packages/web/` - Frontend application (see packages/web/AGENTS.md)
- `packages/cli/` - Command-line tools (see packages/cli/AGENTS.md)

## Shared Skills

Skills apply across all packages:
- **api-standards**: When working on any API
- **testing-patterns**: For all testing
```

**Keep it minimal**: Just navigation and shared concerns.

### Package AGENTS.md

```markdown
# API Package

REST API service using Fastify and PostgreSQL.

## Package Setup

- Build: `pnpm build` (from package directory)
- Test: `pnpm test`
- Dev: `pnpm dev`

## Package-Specific Skills

- **api-routes**: When adding API endpoints
- **database-schema**: When modifying database

## Inherits From Root

See root AGENTS.md for shared monorepo conventions.
```

**Package level**: Package-specific details only.

### Skill Organization

```
.windsurf/skills/
├── shared/                    # Used across packages
│   ├── testing-patterns/
│   └── code-style/
└── package-specific/          # Package-specific
    ├── api-routes/
    └── web-components/
```

Or use package-level skills:
```
packages/api/.windsurf/skills/
└── api-routes/
```

Agents merge: Root AGENTS.md + Package AGENTS.md + Relevant skills

## Key Takeaways

1. **AGENTS.md loads every turn** - Keep it minimal (50-150 lines)
2. **Budget is 150-200 instructions** - Measure and optimize
3. **Skills provide progressive disclosure** - Extract details
4. **Semantic skill references** - Help agents discover when to load
5. **Avoid duplication** - Content lives in one place
6. **No file paths** - Agents navigate, paths go stale
7. **No time-sensitive info** - Goes stale quickly
8. **Critical conventions only** - 5-10 lines max
9. **Link external docs** - Don't duplicate tool documentation
10. **Validate regularly** - Use scripts to maintain quality

AGENTS.md is a router, not a manual. Keep it minimal, leverage skills for detail.
