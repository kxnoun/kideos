# Firestore rules tests

> ⚠️ These tests describe the **device-binding** version of the rules (commit bdf672f). Binding was
> reverted on Oct 17, so the binding cases fail against today's `firestore.rules`. Bring them back together
> with binding (backlog → Security), or update them if binding is dropped.

Checks `firestore.rules` against the real Firestore emulator: paired vs unpaired kid devices, parents,
"Show anyway", pairing codes.

```powershell
cd tests\rules
npm install            # first time
cd ..\..
firebase emulators:exec --only firestore --project demo-kideos "node tests/rules/rules.test.mjs"
```
Needs Java 11+ on PATH (Android Studio's JBR works: `$env:JAVA_HOME\bin`). The `demo-` project id keeps
it fully offline — nothing touches the real Firebase project. Prints PASS/FAIL per case; exit code 1 on
any failure.
