# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the label strings used on GitHub Issues for codingXiang/HarnessOffice.

| Label in mattpocock/skills | Label in our tracker | Meaning                                                                                          |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `needs-triage`             | `triage:inbox`       | New; a maintainer still needs to evaluate it                                                     |
| `needs-info`               | `triage:blocked`     | Waiting on the reporter, or blocked on something outside the issue                               |
| `ready-for-agent`          | `triage:ready`       | Fully specified, ready for an agent                                                              |
| `ready-for-human`          | `triage:ready`       | Same ready queue. Say in the brief when a human must do the work; there is no separate label    |
| `wontfix`                  | `triage:done`        | Leave the open queue: finished, or will not be actioned. Say which in the closing comment       |

When a skill mentions a role (e.g. "apply the AFK-ready triage label", or `/to-spec` applying `ready-for-agent`), use the **Label in our tracker** string. Do not create `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, or `wontfix` as new labels for this workflow.

An open issue carries one state label: `triage:inbox`, `triage:blocked`, or `triage:ready`. Apply `triage:done` when closing it.

## Category labels

`/triage` applies one category label alongside the state label.

| Skill category | Label in our tracker | Meaning                                                                                          |
| -------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `bug`          | `type:bug`           | Something is broken                                                                              |
| `enhancement`  | `type:feature`       | New capability or improvement                                                                    |
| _(chore)_      | `type:chore`         | Maintenance, docs, or tooling. Not one of the two skill categories; use it when neither fits    |

GitHub's default `bug`, `enhancement`, and `wontfix` labels are still on the repo. Do not apply those for this workflow.

## Creating the labels

These seven labels are the vocabulary. They were not created during setup: `gh label create` returned HTTP 403 (the token cannot administer labels). A repo admin should run:

```bash
gh label create "triage:inbox" --description "New issue waiting for evaluation" --color "ededed"
gh label create "triage:ready" --description "Specified enough to start" --color "0E8A16"
gh label create "triage:blocked" --description "Waiting on the reporter or an external blocker" --color "FBCA04"
gh label create "triage:done" --description "Closed: finished, or will not be actioned" --color "C5DEF5"
gh label create "type:bug" --description "Something is broken" --color "D73A4A"
gh label create "type:feature" --description "New capability or improvement" --color "A2EEEF"
gh label create "type:chore" --description "Maintenance, docs, or tooling" --color "CFD3D7"
```
