# Project vs Shared Skills: A Comprehensive Guide

This guide helps you decide where to store skills and how to manage them across projects and teams.

## Table of Contents
- Storage Location Decision Tree (line 20)
- Project-Specific Skills (line 60)
- Shared Personal Skills (line 120)
- Team-Shared Skills (line 180)
- Hybrid Approaches (line 240)
- Migration Strategies (line 300)
- Best Practices Summary (line 360)

## Storage Location Decision Tree

Use this decision tree to determine where a skill should live:

### Question 1: Is this skill specific to one project?

**YES** → Store in project repository (`.windsurf/skills/`)

Examples:
- "Our FastAPI project structure and conventions"
- "Database migration workflow for this Rails app"
- "React component patterns specific to our design system"
- "This project's CI/CD deployment process"

**NO** → Continue to Question 2

### Question 2: Is this skill only useful for you?

**YES** → Store in user-level configuration (personal skills folder)

Examples:
- "My preferred Git commit message style"
- "Python code formatting preferences I use everywhere"
- "My personal debugging workflow"
- "General TypeScript patterns I always follow"

**NO** → Continue to Question 3

### Question 3: Does your team need to use this consistently?

**YES** → Store in team skills repository

Examples:
- "Team's API design standards"
- "Organization-wide security review checklist"
- "Company coding style guide"
- "Shared testing patterns across all projects"

**NO** → Consider if skill is needed at all

## Project-Specific Skills

### Characteristics

Skills that should live in the project repository are:
- **Unique to the codebase**: Architecture, patterns, conventions
- **Version-coupled**: Changes with the project over time
- **Context-dependent**: References specific files, modules, directories
- **Collaboration-critical**: Team members need consistent behavior

### Storage Location

```
my-project/
├── .windsurf/
│   └── skills/
│       ├── project-architecture/
│       │   └── SKILL.md
│       ├── deployment-workflow/
│       │   ├── SKILL.md
│       │   └── scripts/
│       └── testing-patterns/
│           └── SKILL.md
└── ...
```

### Examples of Project-Specific Skills

#### 1. Project Architecture
```yaml
---
name: project-architecture
description: Navigate and understand this project's three-tier architecture with microservices, PostgreSQL database, and Next.js frontend
---
```

**Why project-specific**: Architecture is unique to this codebase.

#### 2. Deployment Workflow
```yaml
---
name: deployment-workflow
description: Deploy this application following our staging → preview → production pipeline with automated testing gates
---
```

**Why project-specific**: Deployment process is specific to this infrastructure.

#### 3. Database Schema
```yaml
---
name: database-schema
description: Work with this project's PostgreSQL schema including user tables, permissions model, and audit logging
---
```

**Why project-specific**: Schema is unique to this application.

### Benefits of Project Storage

✅ **Version control**: Changes tracked alongside code
✅ **Team alignment**: Everyone uses same conventions
✅ **Onboarding**: New team members get skills automatically
✅ **Evolution**: Skills evolve with the project
✅ **Context**: Can reference project-specific files and structure

### Considerations

⚠️ **Avoid overuse**: Don't make project-specific what could be general
⚠️ **Maintenance**: Someone needs to keep skills updated
⚠️ **Discovery**: Team needs to know skills exist

## Shared Personal Skills

### Characteristics

Skills that should live in your personal configuration are:
- **Personal preferences**: Your style, not mandated by team
- **Cross-project patterns**: Useful in multiple codebases
- **General best practices**: Language or framework conventions
- **Tooling preferences**: How you like to use tools

### Storage Location

Depends on your environment:

**Claude Desktop**:
```
~/Library/Application Support/Claude/skills/  # macOS
C:\Users\YourName\AppData\Roaming\Claude\skills\  # Windows
~/.config/claude/skills/  # Linux
```

**VS Code / Cursor / Other IDEs**:
Check tool documentation for user-level skills directory.

**Manual Management**:
```
~/my-skills/
├── python-style/
│   └── SKILL.md
├── git-workflow/
│   └── SKILL.md
└── debugging-patterns/
    └── SKILL.md
```

Then symlink or configure agent to load from this directory.

### Examples of Shared Personal Skills

#### 1. Code Style Preferences
```yaml
---
name: python-code-style
description: Format Python code using black, isort, and my preferred patterns for docstrings, type hints, and error handling
---
```

**Why personal**: Your preferences, not team mandate.

#### 2. Git Commit Style
```yaml
---
name: git-commit-style
description: Write commit messages in conventional commits format with my preferred level of detail and structure
---
```

**Why personal**: Your commit style might differ from teammates.

#### 3. General Language Patterns
```yaml
---
name: typescript-patterns
description: Write TypeScript using functional programming patterns, strict types, and modern ES2022+ features
---
```

**Why personal**: General patterns you apply everywhere.

### Benefits of Personal Storage

✅ **Portability**: Works across all your projects
✅ **Independence**: Don't need team consensus
✅ **Consistency**: Your code looks the same everywhere
✅ **Experimentation**: Try new patterns without affecting team

### Considerations

⚠️ **Conflict potential**: May conflict with project-specific conventions
⚠️ **Isolation**: Teammates won't have your skills
⚠️ **Precedence**: Understand which skills take priority

## Team-Shared Skills

### Characteristics

Skills that should live in a team repository are:
- **Organization standards**: Company-wide conventions
- **Cross-project patterns**: Used in multiple team projects
- **Collaboration requirements**: Consistency needed across team
- **Centrally maintained**: Someone owns keeping them updated

### Storage Location

**Dedicated Skills Repository**:
```
team-skills-repo/
├── README.md                    # Catalog of available skills
├── api-design-standards/
│   ├── SKILL.md
│   └── reference/
├── security-review-checklist/
│   └── SKILL.md
├── testing-patterns/
│   └── SKILL.md
└── code-style-guides/
    ├── python-style/
    │   └── SKILL.md
    └── typescript-style/
        └── SKILL.md
```

**Git Submodule Approach**:
```
my-project/
├── .windsurf/
│   └── skills/
│       ├── project-specific-skill/
│       └── team-skills/         # Git submodule
│           ├── api-design/
│           └── security-review/
└── ...
```

**Package Management Approach**:
```
# Install team skills as a package
npm install --save-dev @company/agent-skills

# Agent configured to load from:
node_modules/@company/agent-skills/
```

### Examples of Team-Shared Skills

#### 1. API Design Standards
```yaml
---
name: api-design-standards
description: Design REST APIs following team conventions for versioning, error handling, pagination, and authentication
---
```

**Why team-shared**: Consistency across all team APIs.

#### 2. Security Review
```yaml
---
name: security-review-checklist
description: Perform security review using team's checklist for authentication, authorization, input validation, and data handling
---
```

**Why team-shared**: Security standards must be consistent.

#### 3. Documentation Style
```yaml
---
name: documentation-style
description: Write technical documentation following team's structure, tone, and completeness standards
---
```

**Why team-shared**: Documentation consistency matters.

### Benefits of Team Storage

✅ **Consistency**: Everyone follows same patterns
✅ **Quality control**: Centralized review process
✅ **Versioning**: Track changes, roll back if needed
✅ **Discoverability**: Catalog of available skills
✅ **Maintenance**: Clear ownership

### Considerations

⚠️ **Governance needed**: Who approves changes?
⚠️ **Update coordination**: How do projects get updates?
⚠️ **Version compatibility**: Handle breaking changes
⚠️ **Distribution**: How do teammates access skills?

## Hybrid Approaches

Most real-world setups use combinations:

### Approach 1: Layered Skills
```
Priority order (later overrides earlier):
1. Team-shared skills (broad standards)
2. Project-specific skills (project conventions)  
3. Personal skills (individual preferences)
```

**Example scenario**:
- Team skill: "Use TypeScript strict mode"
- Project skill: "This project's module organization"
- Personal skill: "My preferred import ordering"

Agent sees all three, with project and personal adding to (not replacing) team standards.

### Approach 2: Explicit Composition
```
my-project/.windsurf/skills/
├── _team/              # Symlink to team skills repo
├── _shared/            # Symlink to personal skills
└── project-specific/   # Project-only skills
```

Make relationships explicit in the directory structure.

### Approach 3: Skill References
```yaml
# In project SKILL.md
---
name: project-conventions
description: This project's specific conventions building on team standards
---

# Project Conventions

This project follows team API standards (see team-skills/api-design-standards)
with these project-specific additions:
- Authentication uses Auth0 specifically
- Database is PostgreSQL 14+ with this schema
- ...
```

Reference other skills explicitly in content.

## Migration Strategies

### From Project-Specific to Shared

When you notice a pattern useful across projects:

1. **Extract common parts**: Remove project-specific references
2. **Generalize**: Make instructions work for multiple contexts
3. **Test**: Verify works in 2+ projects
4. **Move**: Relocate to shared location
5. **Update projects**: Reference or import shared skill

### From Personal to Team

When team adopts your pattern:

1. **Propose**: Share with team for feedback
2. **Generalize**: Remove personal preferences if needed
3. **Document**: Add team context and rationale
4. **Review**: Get team approval
5. **Publish**: Add to team skills repository
6. **Announce**: Let team know it's available

### From Monolithic to Modular

When a skill gets too large:

1. **Identify themes**: Group related content
2. **Split**: Create separate skills for each theme
3. **Use references**: Link skills that relate
4. **Test**: Ensure agent navigates well
5. **Archive**: Keep old version temporarily

## Best Practices Summary

### Project-Specific Skills

**Use when**:
- ✅ Content is unique to this project
- ✅ References specific files or architecture
- ✅ Team needs consistent behavior
- ✅ Evolves with project

**Store in**: `project-repo/.windsurf/skills/`

### Shared Personal Skills

**Use when**:
- ✅ Pattern applies across your projects
- ✅ Personal preference, not team requirement
- ✅ General best practice you always follow
- ✅ Independent of specific codebase

**Store in**: User-level skills directory

### Team-Shared Skills

**Use when**:
- ✅ Organization-wide standard
- ✅ Multiple projects need consistency
- ✅ Requires central maintenance
- ✅ Collaboration-critical

**Store in**: Team skills repository

### Decision Criteria Quick Reference

| Criterion | Project | Personal | Team |
|-----------|---------|----------|------|
| Unique to one codebase | ✅ | ❌ | ❌ |
| Cross-project useful | ❌ | ✅ | ✅ |
| Team must use | ✅ | ❌ | ✅ |
| Personal preference | ❌ | ✅ | ❌ |
| Centrally governed | ❌ | ❌ | ✅ |
| Evolves with project | ✅ | ❌ | ❌ |

### Key Principles

1. **Start local, generalize later**: Begin with project-specific, extract when pattern emerges
2. **Clear ownership**: Someone maintains each skill
3. **Version with care**: Breaking changes need communication
4. **Test combinations**: Ensure skills work together
5. **Document relationships**: Make dependencies explicit
6. **Review regularly**: Archive outdated skills

## Common Questions

### Q: Can I have the same skill in multiple places?

Yes, but manage precedence carefully. Most agent tools have a priority order (e.g., project > team > personal). Document which takes precedence in your setup.

### Q: How do I share a skill with just one other project?

Consider:
1. Duplicating (if they'll diverge)
2. Creating a mini shared-skills repo for just those projects
3. Extracting to team skills if others might use it

### Q: Should I version skills?

Yes for team-shared skills. Use:
- Git tags for releases
- Semantic versioning for breaking changes
- Changelog for notable updates

### Q: How do I test a team skill before rolling out?

1. Create in your personal skills first
2. Test in multiple contexts
3. Share with 1-2 teammates for feedback
4. Refine based on real usage
5. Publish to team repo

### Q: What if project and team skills conflict?

Design skills to compose, not conflict:
- Team skills: Broad standards
- Project skills: Specific implementations
- Make project skills reference/extend team skills
- Document intentional overrides explicitly
