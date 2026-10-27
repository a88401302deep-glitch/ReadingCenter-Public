# Development rules

- Work on one reviewable goal and preserve existing changes.
- Run affected tests first. Before release, retain the full CI quality and browser gates.
- Use synthetic data; do not access production systems, import private backups, or copy secrets into commits.
- Do not deploy, configure external resources, or message other people without authorization.
- Preserve manual metadata and distinguish source failures from successful empty searches.
- See CONTRIBUTING.md for the public/private transfer boundary.
