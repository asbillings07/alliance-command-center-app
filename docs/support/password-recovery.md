# Platform-assisted password recovery

Implements #387 for existing password accounts whose reset email did not arrive.

## Operator workflow

Platform Overview or Support → **Recover account access** → find the registered email. Global user-search results also open this support workflow. Alliance links remain available on the account card.

Verify the owner through an established private contact, confirm the displayed account, and enter your own administrator password. **Create recovery link** issues a 15-minute link; copy it and privately share it with the verified owner. No email is sent by this action. The owner chooses their password through the existing reset form. Do not ask for or choose their password.

Creating the link invalidates older reset links but does not change the password or sign out the owner yet. Successful reset consumes the link, invalidates other outstanding links and revokes all prior sessions. The raw link exists only in the current browser view; refreshing or leaving drops that view. Hiding it does not revoke it. Creating another link requires verification again and at least one minute since the latest issuance.

Google-only accounts and platform administrator accounts are deliberately excluded. This is not email-change, impersonation, account creation, beta admission or Google recovery. An operator without password sign-in must manage their own sign-in methods before using this tool.

## Security and failure behavior

- Page/action authorization reads current platform-admin status; alliance Owner/Admin/Leader roles are insufficient.
- Reauthentication is followed by transactional checks of the operator's current role, password hash and session version. The target's current email and password capability must match the reviewed account. Actor and target rows are locked in deterministic order through issuance.
- The existing cryptographically random, hash-only reset mechanism is reused. All issuance/consumption paths lock User before token rows, preventing an inversion between support reissue and recipient reset. Authoritative expiry is checked after acquiring that lock, so waiting cannot extend a token's lifetime.
- A transaction-scoped advisory lock coalesces overlapping self-service requests without queueing several reset emails. Sequential public replacement behavior remains unchanged; this is not the public endpoint rate/timing hardening in #160.
- The token and an immutable issuance audit snapshot commit together. Audit failure rolls everything back, including prior-token invalidation. History records operator, target and issuance/expiry only; it is not proof that a reset completed. No raw link, password or token hash is stored in that audit.
- The new link/password regions are blocked from session replay; the action does not log credentials, raw errors or tokens. No browser storage is used. The reset recipient continues through the existing reset route.
- A response failure is not proof of rollback. Refresh and inspect issuance history before retrying; a link might have been created and replaced an older one even if its response was lost. No secret link can be recovered from history.

This follows the existing reset design and [OWASP reset guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) for one-time expiring tokens and owner-selected passwords. #98's post-reset notification and #160's public reset hardening remain separate open work.

## Qualification and release

Use disposable local accounts/database for real token, authorization, rollback, concurrency, expiry and session-revocation tests. Browser QA covers phone/tablet layout, accessibility, wrong-password refusal, clipboard success, recipient reset, session revocation, used-link rejection and no link after reload. Never record a live recovery link in a PR, screenshot or test artifact.

Independent review, green CI and owner Human QA are required before merge/release. Main automatically deploys production; preparing this PR does not authorize resetting a real account, contacting a person or deploying production.
