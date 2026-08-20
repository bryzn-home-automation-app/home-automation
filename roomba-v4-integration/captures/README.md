# captures/

Drop raw probe output here (e.g. `probe2-2026-08-19.txt`). Everything in this folder
except this README is **git-ignored** — raw shadow dumps contain your BLID and serial
number.

Before sharing a capture upstream with the `roombapy-prime` maintainer, redact:

- **BLID** — the 32-hex robot id
- **Serial number** — keep the `G284020` SKU prefix (public model info), redact the rest

Keep the model-identifying fields (`sku`, `series`, `family`) — those are what the
maintainer needs to add support for this model line.
