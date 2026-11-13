---
name: Feature request
about: Suggest an idea or improvement for the viewer
title: "[Feature] "
labels: enhancement
assignees: ''
---

## Is your feature request related to a problem?

A clear and concise description of what the problem is (e.g. "I'm always frustrated
when...").

## Describe the solution you'd like

A clear and concise description of what you want to happen. If it changes what the page reads from the
vault or the API, say which records or requests.

## Describe alternatives you've considered

Any alternative solutions or features you've considered.

## Scope check

- [ ] This keeps the page read-only: it never writes to the vault (writing meals from a browser needs
      conflict handling that the apps own).
- [ ] This keeps everything in memory: no browser storage, cookies or URL state, and nothing readable sent
      to any server.
- [ ] This needs no new network destination, or the request explains why it is needed and what it would carry.
- [ ] This does not require embedding nutrition or reference values in the page: those come from the API.

## Additional context

Add any other context, references, or screenshots about the feature request here. Do not include real
journal data.
