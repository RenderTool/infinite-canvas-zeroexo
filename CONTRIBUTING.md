# Contributing to ZeroExo Platform

Thanks for taking the time to contribute. Please read the guidelines below
before opening an issue or a pull request.

## Code of Conduct

Be respectful and constructive. Harassment or personal attacks are not
tolerated.

## Getting Started

1. Fork the repository.
2. Clone your fork and create a feature branch:

   ```bash
   git checkout -b feat/your-feature-name
   ```

3. Set up the local environment (see [README.md](README.md) → Quick Start).
4. Make your changes and verify them:

   ```bash
   # backend
   cd zeroexo_backend
   pnpm typecheck && pnpm build

   # admin
   cd ../zeroexo_admin
   pnpm lint && pnpm build
   ```

5. Commit with a clear message and open a pull request to `main`.

## Pull Request Guidelines

- Keep changes focused: one PR should address one concern.
- Add or update tests where behavior changes.
- Do not commit `.env` files, lockfile changes unrelated to your work, or
  generated `dist/` output.
- Ensure the branch is up to date with `main` before submitting.

## Commit Message Style

Use the imperative mood and a concise summary, for example:

```
feat: add model usage ranking chart
fix: reject invalid storage keys on upload
```

## Project Structure

See [README.md](README.md) → Repository Structure for the layout of
`zeroexo_backend/` and `zeroexo_admin/`.

## Reporting Issues

- For bugs: include the version, steps to reproduce, expected vs actual
  behavior, and relevant logs.
- For security vulnerabilities: follow [SECURITY.md](SECURITY.md) instead of
  opening a public issue.
