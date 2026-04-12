# LaunchDeck Proving Program

System-level dogfooding program for proving that NanoClaw can take a user-visible
product from WhatsApp request to shipped feature with operator trust.

Use this when evaluating whether NanoClaw is ready to function as a
WhatsApp-first product owner interface instead of a coding assistant that still
needs laptop supervision.

Mission anchor: `docs/MISSION.md`.

## Control Owner

Owner for:
- `docs/workflow/strategy/launchdeck-proving-program.md` guidance, decisions, and maintenance in this document

Should not contain:
- policy, workflow detail, or implementation behavior that belongs in a more specific owner doc, skill, or enforcement surface

## Objective

Build one real app, `LaunchDeck`, through the normal Andy/worker flow while
treating every product failure and workflow rough edge as a NanoClaw
improvement opportunity.

The program is successful only if product delivery quality improves while
operator involvement decreases.

## Why LaunchDeck

`LaunchDeck` is a strong proving target because it forces NanoClaw to handle:

1. user-facing UI quality, not only backend correctness
2. repeated CRUD and state-transition flows
3. responsive design and mobile ergonomics
4. browser-tested interactions with meaningful success and error states
5. incremental shipping across multiple feature slices

It is small enough to finish, but complex enough to expose weak contracts, weak
testing, weak review, and weak recovery behavior.

## Program Rules

1. Product-owner intent must originate through WhatsApp only.
2. Every feature must be reduced to a strict user-visible contract before
   implementation starts.
3. UI-impacting work requires real browser flow validation by the implementing
   worker.
4. Issues found during required validation must be fixed in the same worker lane
   before completion unless they are truly out of scope and escalated.
5. Andy must reject smoke-only evidence when the feature changes a real user
   flow.
6. Every structural failure found during the proving program must be turned into
   a NanoClaw improvement item before graduation.

## Working Definition Of Trust

NanoClaw is trustworthy for WhatsApp-first product delivery when:

1. the user can describe the desired outcome in plain language
2. the system turns that into a clean feature contract without manual cleanup
3. workers implement and validate the right thing
4. user-visible regressions are caught before approval
5. the owner brief is sufficient to trust the result without opening the laptop

## Milestones

### Milestone 0: Proving Harness

Set the proving rules before any product feature work is accepted.

Required outputs:

1. this proving-program brief
2. a standard feature-slice contract format
3. a scorecard for every feature run
4. a failure taxonomy used to classify every rough edge
5. a graduation bar for declaring the system trustworthy

### Milestone 1: Skeleton Product

Ship the minimum usable frame:

1. landing page
2. authentication
3. empty dashboard
4. create first launch project

### Milestone 2: Core Launch Planning

Ship the planning core:

1. milestones
2. tasks
3. statuses
4. due dates
5. owners or assignees

### Milestone 3: Working Views

Ship multiple planning views:

1. list view
2. board view
3. timeline or calendar view
4. filters and search

### Milestone 4: Collaboration Layer

Ship collaboration surfaces:

1. notes
2. comments
3. activity feed
4. shareable public launch page

### Milestone 5: Polish And Recovery

Raise quality and punish weak workflow behavior:

1. mobile polish
2. loading, empty, and error states
3. interrupted-run recovery checks
4. regression passes across previously shipped flows

### Milestone 6: Ship Discipline

Prove that delivery is not only implementable but safely releasable:

1. deploy through the standard NanoClaw flow
2. verify post-deploy health
3. record rollback instructions
4. measure owner confidence from the final WhatsApp brief

## Feature-Slice Contract

Every LaunchDeck feature must be expressed in the same shape before dispatch:

1. slice id
2. user goal
3. affected flow
4. scope
5. non-goals
6. acceptance criteria
7. required test type
8. release risk
9. rollback note

Recommended JSON-like shape:

```text
slice_id: LD-##
user_goal: <what the user wants to accomplish>
affected_flow:
  <entry -> action -> expected result>
scope:
  - ...
non_goals:
  - ...
acceptance:
  - ...
required_test_type: ui-flow | api-flow | integration | internal-only
release_risk: safe | flagged | manual-review
rollback_note: <how to disable or back out safely>
```

## Scorecard For Every Feature

Record these fields for every LaunchDeck slice:

1. contract clarity: `clean | revised | ambiguous`
2. first-pass implementation: `pass | fail`
3. required validation coverage: `complete | partial | weak`
4. issues found during validation: count
5. issues fixed before completion: count
6. rework loops required: count
7. regression introduced: `yes | no`
8. owner brief quality: `sufficient | insufficient`
9. operator intervention needed beyond WhatsApp: `yes | no`
10. ship verdict: `ship | rework | blocked`

## Failure Taxonomy

Every rough edge found during the program must be classified into one bucket:

1. contract generation
2. dispatch quality
3. worker implementation
4. browser or user-flow validation
5. Andy review quality
6. runtime or recovery
7. release or rollback
8. owner brief quality

Use this taxonomy to decide whether the next step is:

1. fix the product only
2. fix NanoClaw behavior first
3. stop the proving program until a structural issue is resolved

## Graduation Bar

Do not call the system trustworthy until all of these are true:

1. at least `10` consecutive feature slices ship through the standard flow
2. every UI-impacting slice includes task-relevant browser flow evidence
3. worker-owned validation catches and closes in-scope regressions before
   approval
4. no critical user-visible regression escapes required validation
5. the operator can trust the WhatsApp summary without opening the laptop for
   normal slices
6. restart or recovery events no longer meaningfully corrupt execution

## LaunchDeck Initial Slice Pack

Start with five slices that progressively stress contracts, UI flows, and
review quality.

### LD-01: Create First Launch Project

- user goal: create a new launch workspace with a title, target date, and short
  description
- affected flow: dashboard -> create project -> submit -> project detail page
- scope:
  - create-project form
  - field validation
  - success redirect to project detail
- non-goals:
  - collaboration
  - task management
- acceptance:
  - user can create a project from an empty dashboard
  - required fields validate correctly
  - success state lands on the created project
  - refresh preserves the created project
- required test type: `ui-flow`
- release risk: `safe`
- rollback note: hide project creation entry point if persistence or redirect is
  unstable

### LD-02: Add Launch Milestones

- user goal: add milestone checkpoints to a launch project
- affected flow: project detail -> add milestone -> save -> ordered milestone
  list
- scope:
  - milestone list
  - create milestone form
  - ordering by date
- non-goals:
  - task assignment
  - notifications
- acceptance:
  - milestone can be added from project detail
  - milestones appear in chronological order
  - invalid dates are rejected clearly
- required test type: `ui-flow`
- release risk: `safe`
- rollback note: disable milestone creation if ordering or persistence becomes
  inconsistent

### LD-03: Add Tasks Under A Milestone

- user goal: break a milestone into executable tasks
- affected flow: milestone section -> add task -> mark task status -> task list
  updates
- scope:
  - task creation
  - task status change
  - milestone-scoped task list
- non-goals:
  - comments
  - assignees
- acceptance:
  - user can add multiple tasks under a milestone
  - status updates are reflected immediately
  - task count and empty states stay correct
- required test type: `ui-flow`
- release risk: `safe`
- rollback note: fall back to read-only task display if write path is unstable

### LD-04: Board View For Tasks

- user goal: see launch tasks grouped by status in a board layout
- affected flow: project detail -> switch to board view -> drag or move task ->
  board updates
- scope:
  - board tabs or toggle
  - task cards by status
  - status move interaction
- non-goals:
  - calendar view
  - public sharing
- acceptance:
  - board renders the same task set as list view
  - moving a task updates status and persists after refresh
  - empty columns remain understandable
- required test type: `ui-flow`
- release risk: `flagged`
- rollback note: keep list view as fallback default if board persistence or drag
  behavior is flaky

### LD-05: Public Launch Share Page

- user goal: share launch progress with external stakeholders using a public
  read-only page
- affected flow: project detail -> enable public share -> open public URL ->
  view project summary
- scope:
  - public share toggle or action
  - public read-only page
  - visible summary of milestones and tasks
- non-goals:
  - public editing
  - authentication changes
- acceptance:
  - enabling share generates a stable public URL
  - public page hides private controls
  - public page reflects project status accurately
  - disabling share revokes access cleanly
- required test type: `ui-flow`
- release risk: `manual-review`
- rollback note: disable public route immediately if access control is uncertain

## Execution Rhythm

Run one slice at a time through the normal NanoClaw loop:

1. WhatsApp request
2. contract compilation
3. Andy dispatch
4. worker implementation
5. worker validation and in-scope fixes
6. Andy review
7. owner brief
8. scorecard update
9. structural-improvement capture if needed

Do not run multiple proving slices in parallel until first-pass quality is
stable.

## Kickoff WhatsApp Messages

Use short, outcome-first prompts so the proving program evaluates NanoClaw's
contract-compilation quality instead of rewarding over-specified operator input.

### Kickoff Message 1: Start The Program

```text
I want to prove NanoClaw can build and ship a real product through WhatsApp
only. Start a proving program for a product called LaunchDeck, a launch-planning
app for solo founders and small teams. Define the first milestone, the first
feature slice, the acceptance criteria, and the exact user flow that must pass
before approval.
```

### Kickoff Message 2: First Slice

```text
Build the first LaunchDeck feature slice: create the first launch project from
an empty dashboard. I want a polished user flow, not just a form that submits.
The worker must test the real browser flow and fix any in-scope issues before
completion.
```

### Kickoff Message 3: Post-Run Brief Request

```text
Summarize the run in product-owner terms only: what changed, what user flow was
tested, what issues were found and fixed, what risk remains, and whether I
should trust this slice without opening the laptop.
```

## Stop Conditions

Pause the proving program and fix NanoClaw itself before continuing if any of
these occur:

1. repeated ambiguous contracts on adjacent slices
2. repeated smoke-only approvals for flow-changing work
3. recovery or restart behavior corrupts completion confidence
4. browser validation is flaky enough that it cannot act as a release signal
5. owner brief quality remains too weak to trust without laptop inspection

## Next Action

Start with `LD-01: Create First Launch Project` as the first proving slice and
record the full scorecard after the first end-to-end run.

Use `docs/workflow/strategy/launchdeck-ld01-execution-pack.md` as the concrete
dispatch and review artifact for the first run.
