# LaunchDeck LD-01 Execution Pack

Operational pack for the first LaunchDeck proving slice:

- slice id: `LD-01`
- title: `Create First Launch Project`
- purpose: convert the proving-program concept into a concrete Andy -> worker ->
  review -> owner-brief run

Use this with `docs/workflow/strategy/launchdeck-proving-program.md`.

## Control Owner

Owner for:
- `docs/workflow/strategy/launchdeck-ld01-execution-pack.md` guidance, decisions, and maintenance in this document

Should not contain:
- policy, workflow detail, or implementation behavior that belongs in a more specific owner doc, skill, or enforcement surface

## Slice Objective

Deliver the first meaningful LaunchDeck workflow:

1. land on an empty dashboard
2. open project creation
3. submit project name, target date, and short description
4. arrive on the created project detail page
5. confirm persistence after refresh

This slice proves whether NanoClaw can handle a real user-visible CRUD flow from
contract to browser-tested completion.

## Product Contract

### User goal

As a founder, I can create my first launch project from an empty dashboard so I
can begin planning a release.

### Affected flow

`dashboard -> create project -> fill form -> submit -> success redirect ->
project detail -> refresh -> project still exists`

### Scope

1. empty dashboard state with create-project entry point
2. create-project form with:
   - project name
   - target date
   - short description
3. required-field validation
4. success redirect to project detail page
5. persisted project detail view after refresh

### Non-goals

1. milestones
2. tasks
3. collaboration
4. notifications
5. public sharing

### Acceptance Criteria

1. user can create a project from the empty dashboard
2. missing required fields produce clear validation feedback
3. successful submission redirects to project detail
4. project detail shows the submitted values
5. refresh preserves the project and does not return the user to the empty
   state
6. mobile layout remains usable on the create-project flow

### Required Test Type

`ui-flow`

### Release Risk

`safe`

### Rollback Note

If persistence or redirect behavior is unstable, hide the create-project entry
point and revert to read-only dashboard state.

## Andy Dispatch Requirements

The first run should not be dispatched as vague build work. Andy should include:

1. slice id: `LD-01`
2. explicit user goal and affected flow
3. scope and non-goals copied from this pack
4. `browser_required: true`
5. worker instruction to fix any in-scope browser-found issue before completion
6. owner-brief requirement in product terms, not engineering terms

Recommended task framing:

```text
Implement LD-01 for LaunchDeck: create the first launch project from an empty
dashboard. The worker must validate the real browser flow from empty state to
successful project creation and persisted project detail, including mobile
usability and validation states. Any in-scope issue found during required
validation must be fixed before completion.
```

## Worker Completion Requirements

Worker completion is insufficient unless it includes:

1. server startup and readiness evidence
2. exact routes exercised
3. flow steps exercised in the browser
4. `chrome-devtools` tool calls and key outputs
5. any issue found during validation and whether it was fixed
6. pass/fail verdict against the product contract
7. explicit no-screenshot confirmation

## Andy Review Checklist

Andy should reject the run if any of these are missing:

1. empty-dashboard starting state was not exercised
2. required-field validation was not checked
3. success redirect was not checked
4. post-refresh persistence was not checked
5. mobile usability was not checked in any way
6. browser-tool evidence is smoke-only or route-only
7. a browser-found regression remains unfixed inside scope

Approve only if the evidence proves the full user flow.

## Scorecard Row Template

Record one row for this slice after review:

```text
slice_id: LD-01
contract_clarity: clean | revised | ambiguous
first_pass_implementation: pass | fail
validation_coverage: complete | partial | weak
issues_found: <number>
issues_fixed_before_completion: <number>
rework_loops: <number>
regression_introduced: yes | no
owner_brief_quality: sufficient | insufficient
operator_intervention_beyond_whatsapp: yes | no
ship_verdict: ship | rework | blocked
notes: <short summary>
```

## Owner Brief Template

The final owner brief for this slice should be no more than a short WhatsApp
message and must answer:

1. what changed for the user
2. what exact flow passed
3. what issues were found and fixed
4. what risk remains
5. whether the owner should trust the slice without opening the laptop

Recommended format:

```text
LD-01 shipped/rework.
User-visible change: <one sentence>.
Validated flow: <one sentence>.
Issues found and fixed: <short sentence>.
Residual risk: <short sentence>.
Trust verdict: yes/no.
```

## Exit Decision

This slice should be marked:

- `ship` only if the full browser flow passes and no in-scope regression is left
  unresolved
- `rework` if the feature mostly exists but the user flow or quality bar is not
  met
- `blocked` if the feature cannot be validated due to structural NanoClaw or
  runtime problems

## What LD-01 Teaches About NanoClaw

This first slice is not only a product feature. It is a system probe for:

1. contract clarity
2. worker ability to polish a simple but real flow
3. Andy willingness to reject weak browser evidence
4. quality of the owner-facing summary
5. whether the system can be trusted on the smallest real product slice
