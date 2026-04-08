---
created: 2026-04-08T20:59:18.636Z
title: Reconsider README framing as standalone MCP server
area: docs
files:
  - README.md
---

## Problem

The current README opens by positioning tlaplus-mcp primarily as "the tooling backend for tlaplus-workflow" and the architecture diagram reinforces tight coupling to that plugin. This framing undersells the server's independent value: it exposes TLA+ tools (TLC, SANY, PlusCal, TLATeX) as structured JSON over a standard protocol, which is useful to any MCP client, agent framework, or custom integration — not just the tlaplus-workflow plugin.

## Solution

Reframe the README to lead with the server's standalone value proposition (what it does, why that's useful), then mention tlaplus-workflow as one notable consumer rather than the primary reason for the project's existence. Consider moving the tlaplus-workflow relationship section lower or into a "Ecosystem" subsection.
