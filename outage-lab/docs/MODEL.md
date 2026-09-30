# Model and simplifications

## Dependencies and states

Each of the seven services is `up`, `slow` (with a delay in milliseconds, 1 to 15000) or `down`.

Internet and DNS are network prerequisites. Every remote service (backend, login provider, payment, email, CDN) needs both. The engine computes an **effective state** for each service:

1. If the service or any prerequisite is down, it is `down`, and the first failing link is recorded as the cause.
2. Otherwise the delays of the service and its prerequisites are added.
3. If the total is above the timeout (3000 ms), the service is `timeout`. If it is above zero, it is `slow`. Otherwise it is `up`.

## Judging a feature

Each feature lists the services it calls, separately for the two designs.

- A service that is `up`, or `slow` within the timeout, does not affect the result.
- **Cloud-coupled design:** any `down` service breaks the feature. A `timeout` also breaks it, because this design has no timeout and the screen freezes while it waits.
- **Local-first design:** a `down` or `timeout` service triggers the feature's fallback. If the fallback is possible the feature is **limited**; if not, it is **broken**.

| Fallback | Possible when |
| --- | --- |
| Saved catalogue | the device has a saved catalogue |
| Search the saved catalogue | the device has a saved catalogue |
| Saved session | the device has a saved session |
| Offline queue | always |
| Text placeholders | always |

Score per scenario: works = 1, limited = 0.5, broken = 0, averaged over eight features, times 100.

## The real clients

`web/core/clients.js` implements both designs as code that actually calls the simulated services.

The local-first client wraps each call as timeout, then circuit breaker, then retry:

- Timeout: 3000 ms.
- Retry: two extra attempts with exponential backoff (200 ms, 400 ms) for idempotent operations only. Sending email is not retried; it is queued instead.
- Circuit breaker per service: opens after three consecutive failures, fails fast for 5000 ms, then allows one trial call.
- Offline queue: first in, first out, stored in IndexedDB when available. Replaying stops at the first item that still fails so later work never overtakes earlier work.
- Payments are keyed by order ID in the simulated provider, so a retried or replayed charge never creates a second charge.

`tests/consistency.test.js` checks that the real clients produce exactly the results the engine predicts, for every preset and for 40 seeded random outages. Random scenarios with a delay within 500 ms of the timeout are skipped in that test because wall-clock jitter could push them either way.

## Time

Simulated delays are logical milliseconds. The page runs them four times faster than real time; the tests run them fifty times faster.

## Deliberate simplifications

- The page is already loaded when the outage starts. First-load failure is only covered by the service worker.
- No DNS cache, connection reuse, packet loss, partial responses or rate limiting.
- The session is either saved or not. There is no token expiry.
- Catalogue prices are fixed. There is no stock, server-side validation or conflict resolution between devices.
- A payment call that times out keeps running inside the simulated provider and is still recorded there, like a charge that was accepted but whose reply was lost. The client only sees the timeout, queues the order, and the idempotency key keeps the replay from charging twice. Real providers have more possible outcomes than this.
- One device, one tab.

This is a teaching model. It does not audit or certify any real application.
