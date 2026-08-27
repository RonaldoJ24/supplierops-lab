## Summary

<!-- What changed, and why? Keep the description grounded in the checked-in fixtures and contract. -->

## Quality and safety checklist

- [ ] I ran `npm run check` (typecheck, lint, format, tests, database, build, and secret verification).
- [ ] I ran `npm run e2e` when the Electron/runtime path changed.
- [ ] I ran `npm run screenshots` and inspected the committed screenshots when the UI changed.
- [ ] I ran `npm run verify:secrets`; no credential, token, authorization header, or private key is included.
- [ ] Renderer changes use only the typed `window.supplierOps` bridge; no Node/Electron/env access was added.
- [ ] Provider disclosures are accurate; no live Coupa/ERP or production OCR claim was added.
- [ ] Approval and downstream `Submit · local/mock` remain separate and explicitly controlled.
- [ ] Prompt-injection and invalid-output cases remain blocked/quarantined.
- [ ] Any fixture/evaluation change has explicit observed/sample-size coverage and updated tests.
- [ ] I did not commit local databases, `.env.local`, secrets, or unrelated generated files.

## Verification evidence

<!-- List exact commands and notable output. Link screenshots or traces when relevant. -->

## Notes / limitations

<!-- Call out fixture limitations, provider availability, unsigned package status, or follow-up work. -->
