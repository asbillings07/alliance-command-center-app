# Changelog

All notable changes to Alliance Command Center will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Platform Operations Console for operational visibility (ADR-010)
- Capability-based authorization architecture (ADR-007)
- Design system foundation with consistent components (ADR-009)
- Health check endpoint at `/api/health`
- Environment validation at startup
- Feature flag system for safe feature rollout
- Production seed guard to prevent accidental data corruption

### Changed
- Reorganized platform services by operational subdomain
- Improved invitation flow messaging

### Fixed
- Leadership note refresh after save
- Setup completion rules for owners

## [0.1.0] - 2026-07-16

### Added
- Initial release
- Multi-tenant alliance management
- Member roster with import
- Metric configuration and evaluation periods
- Leadership notes
- Collaborator invitations
- Beta invitation system
- Role-based access control (Owner, Admin, Leader, Viewer)

---

## Release Notes Format

Each release should include:

1. **Added** - New features
2. **Changed** - Changes to existing functionality
3. **Deprecated** - Features to be removed in future
4. **Removed** - Removed features
5. **Fixed** - Bug fixes
6. **Security** - Security improvements

### Known Issues

Document any known issues that beta users should be aware of:

- None currently documented
