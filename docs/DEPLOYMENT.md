# Deployment status and boundary

No deployment was performed. No source/Android/VPS/DNS/Nginx/visibility changes or merge were performed. A public repository is not an access-control boundary for an incomplete staging application.

The review entry binds loopback, requires a separate private gate on every route, refuses NODE_ENV=production and returns non-release-ready (503) from readiness. There is no Pages/upload/deploy workflow. Approved future staging must remain authenticated/default-deny even if its URL is known.

See OPERATIONS.md for install, bootstrap/MFA, migrate/start, private data placement, retention, encrypted recovery and rollback. Before a separate deployment request, provide a concrete domain/origin/port and isolation plan, TLS/Secure-cookie/proxy configuration, service account/permissions, capacity/disk limits, monitoring, backup verification and rollback. Physical iPhone acceptance remains a gate. Do not treat the existing review server as production-ready.
