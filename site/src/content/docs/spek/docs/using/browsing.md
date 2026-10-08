---
title: Browsing
description: spek's views — dashboard, specs, changes, schemas, graph, timeline — and search.
sidebar:
  order: 1
---

Every form of spek has the same navigation: **Overview**, **Specs**, **Changes**, **Graph**, **Schemas**,
and **Timeline**, plus search.

## Overview

The dashboard counts specs, active changes, and archived changes, and shows task completion, the average
lifecycle of archived changes, and how many active changes have gone stale (no movement for over 30 days).
Below that: the active changes with their task progress, and the recently archived ones.

## Specs

Every spec as a folder tree, nested as `openspec/specs/` is on disk, with a filter. A spec opens as an
outline: requirements and scenarios fold in place, and the normative keywords (SHALL, MUST) and the
scenario steps (WHEN, GIVEN, THEN, AND) are highlighted. Each spec also shows its revision history from
git.

## Changes

Active and archived changes, each row with its creation date, archive date, and lifecycle. A change opens
with its artifacts as tabs — proposal, design, tasks, and specs — in the order its workflow schema defines
them or by last modified. Delta specs carry a badge for each operation (ADDED, MODIFIED, REMOVED, RENAMED);
task lists show their checkboxes with progress per section.

## Graph

How specs and changes relate: each change is linked to the specs its deltas touch.

## Schemas

Every workflow schema the repository can use, with where it comes from and the artifacts it defines. A
schema opens as a flow: each artifact in dependency order, the file it produces, what it needs before it can
be written, and its instructions. The repository's default schema is marked, and each schema links to the
active changes using it.

## Timeline

Every change's lifecycle as a horizontal, Gantt-style chart: archived changes as bars from creation to
archive, active ones running to today. Changes can be grouped by spec topic, and active or archived changes
hidden.

## Search

`Ctrl+K` (`Cmd+K` on macOS) searches the text of every spec and change.

## Theme

spek has a dark and a light theme; the button in the header switches between them.
