# Firestore rules tests

Checks `firestore.rules` against the real Firestore emulator: paired vs unpaired kid devices, parents,
"Show anyway", pairing codes, kid devices (`kidDevices` — which children a device may use) and moving
over devices paired before Oct 20, 2026 (`deviceMigrations`), and invite-only servers
(`instance/access` + `members/{email}`).

```powershell
cd tests\rules
npm install            # first time
cd ..\..
firebase emulators:exec --only firestore --project demo-kideos "node tests/rules/rules.test.mjs"
```
Needs Java 11+ on PATH (Android Studio's JBR works: `$env:JAVA_HOME\bin`). The `demo-` project id keeps
it fully offline — nothing touches the real Firebase project. Prints PASS/FAIL per case; exit code 1 on
any failure.
