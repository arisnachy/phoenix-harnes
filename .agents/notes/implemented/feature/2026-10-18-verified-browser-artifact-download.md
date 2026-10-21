# Verified browser downloads for produced files

On 2026-10-18, Phoenix could announce “Descargar el PDF” without a clickable asset even when the publication tool wrote valid PDF/DOCX outputs. The produced-files row used the host's native file opener, not a browser download. User-authored prose is insufficient evidence for arbitrary file access.

## Decision

The existing `ui-deliverables` plugin passes the owner session id to its produced-files lane. Loopback Web renders an ordinary download link for every successful mutation location; other carriers retain native-open semantics. The `apiproxy` GET/HEAD endpoint checks the exact path against successful mutation calls in the authoritative session history and active tool presenter before opening it, then verifies a bounded nonempty regular file and sends attachment bytes. Untrusted prose never authorizes a read. This facility is independent of PDF and Research Studio; all file-producing skills can participate by declaring real mutation locations.

## Validation

Focused requirements: GET/HEAD wire tests, browser produced-file lane tests, missing or unauthorized paths, no unsupported download claim. Local build and real-PDF Web e2e must pass before deployment. Files made indirectly by terminal commands without declared mutation locations remain outside this mechanism and require a publishing step recording those locations.
