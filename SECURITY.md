# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. Please **do not** open a public issue for security vulnerabilities.

Report vulnerabilities privately to **750831855@qq.com**, or use GitHub's
private vulnerability reporting feature on this repository if available.

Please include in your report:

- The affected version(s) and file paths.
- A step-by-step reproduction of the issue.
- The impact and any proposed fix (optional).

We will acknowledge your report within 3 business days and keep you informed
as the issue is triaged and fixed. Security issues are prioritized over
feature work.

## Security Baseline

This project applies the following safeguards:

- Fail-fast validation of JWT secrets and the AES-256-GCM encryption key.
- Role-based access control (`super_admin` / `admin` / `operator` / `user`)
  enforced on both API and admin endpoints.
- Storage key validation against path traversal.
- Rate limiting with an explicit whitelist (no implicit internal-network trust).
- Sensitive credentials are excluded from the repository (see `.env.example`
  for required variables).
