# Offline contract — M2 and M3

## Data and authorization

Preferences and M3 tasks/projects/areas/milestones/saved filters are implemented offline. A successful authenticated bootstrap grants a tab lease bounded by session expiry and the configured idle timeout. The lease is in sessionStorage; a worker obtains its own lease through an authenticated request. Reloading the same tab works offline until expiry. Cold offline tabs show a lock. Expiry hides private content and retains encrypted pending changes for online reauthentication. Server revocation can only be discovered when connectivity returns; the lease bounds this interval.

IndexedDB stores a nonextractable AES-256-GCM CryptoKey and encrypted snapshot plus queue per user. Every write has a random 96-bit IV and tenant/schema-bound authenticated data. Keys never derive from server secrets. This protects against plaintext database inspection, not malicious same-origin JavaScript, a compromised browser/OS, or an attacker capable of modifying the local authorization check. This is not an independently password-protected vault. Sign-out, revoke-all and clear-cache erase local keys and payloads; BroadcastChannel locks other tabs. Clearing pending data is destructive and asks for confirmation.

## Writes and recovery

General and appearance preferences save locally before reporting success. Security lifetime changes require the online version-checked endpoint. Revision compare-and-swap prevents concurrent IndexedDB updates from losing queue entries. The queue is capped at 1,000 entries.

Each mutation carries a UUID, client UUID and monotonic timestamp. The server locks the settings row, compares individual field clocks (timestamp, then client ID), and atomically records settings, audit and an idempotency receipt. Replaying the same ID and content returns the original acknowledgement; changed content with the same ID is rejected. Timestamps over five minutes ahead are rejected. Older conflicting fields lose without overwriting newer values. The client removes only acknowledged entries, reapplies remaining optimistic changes, and refreshes the current server snapshot. Retry uses exponential jitter capped at 60 seconds. Permanent rejection retains the queue and shows an error; correct the clock/reconnect or deliberately clear local data.

Schema v1 payloads are validated on every read. Future incompatible formats require an explicit migration; never delete unreadable queues automatically. Current receipts are retained indefinitely to preserve replay safety.

## Worker and install

The public precache includes only the offline HTML, compiled JS/CSS, manifest, icons and explicitly labelled test screenshots. Authenticated HTML, API responses and OAuth requests are never cached. Static Next build assets use a bounded stale-while-revalidate cache. Navigation tries the network, then the generic offline document; private values are decrypted only after local authorization.

Background Sync is progressive enhancement and requires connectivity and a valid server session. Unsupported browsers use online/focus events or Sync now. Browser storage eviction can remove unsynced data; this cache is not a backup.

Installation requires an explicit click, supports dismissal for seven days, and provides iOS instructions. Service-worker updates wait for approval and are blocked by unsaved forms, queued changes or an inaccessible existing vault. No automatic reload occurs during first installation. Manifest shortcuts cover implemented destinations only.

## Manual production checks

After configuring real Google credentials and HTTPS, authenticate, install on supported target devices, edit preferences offline, reload the same tab, reconnect and verify one server update. Try expiry, revoke-all on another device, clear-cache with a pending edit, and approving a deployed worker update. Test iOS Share installation separately. Automated Chromium tests do not certify physical-device installation, OS background execution, or live Google consent.

M3 adds optional work snapshot/queue fields while preserving existing encrypted M2 preference mutations. Work bootstrap is explicitly requested with `?work=1`. Install the offered update to upgrade the worker as well as the page; do not downgrade to an M2 bundle after editing M3 data. Future incompatible schema changes must migrate encrypted content without deleting pending edits.
