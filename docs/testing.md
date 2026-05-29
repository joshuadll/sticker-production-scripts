# Testing Conventions

ExtendScript cannot be unit tested in isolation — `app`, `activeDocument`, and
all layer/path objects only exist inside a live Adobe application. The testing
approach here uses golden-file integration tests driven by `osascript`.

---

## How it works

1. A fixture file (minimal PSD or AI with known layer names) is opened in the app
2. `osascript` invokes the step script against that fixture
3. The script writes a log file to a known path (`CONFIG.logPath`)
4. The log is diffed against a committed expected output file
5. Pass = no diff. Fail = diff printed, exit code 1

---

## Folder structure

```
tests/integration/
  fixtures/           ← minimal PSD/AI files with known layer names
  expected/           ← committed golden output files (one per step)
  run-step1.sh        ← test runner for step 1
  run-step2a.sh       ← test runner for step 2a
  run-step2b.sh       ← test runner for step 2b
  ...
  run-all.sh          ← runs every run-*.sh, reports pass/fail summary
```

---

## Shell runner template

Copy this for each new step. Replace `STEP`, `APP`, `SCRIPT`, and `FIXTURE`.

```bash
#!/bin/bash
# tests/integration/run-STEP.sh

STEP="stepN"
APP="Adobe Photoshop 2024"          # or "Adobe Illustrator"
SCRIPT="$(pwd)/photoshop/stepN.jsx" # or illustrator/
FIXTURE="$(pwd)/tests/integration/fixtures/test-sku.psd" # or .ai
LOG="/tmp/${STEP}-test.log"
EXPECTED="$(pwd)/tests/integration/expected/${STEP}-expected.txt"

rm -f "$LOG"

osascript -e "tell application \"$APP\"
    open POSIX file \"$FIXTURE\"
    do javascript file \"$SCRIPT\"
end tell"

# Wait for log (script must write CONFIG.logPath = LOG on completion)
TIMEOUT=30
ELAPSED=0
until [ -f "$LOG" ] || [ $ELAPSED -ge $TIMEOUT ]; do
    sleep 1
    ELAPSED=$((ELAPSED + 1))
done

if [ ! -f "$LOG" ]; then
    echo "FAIL [$STEP]: log never written (crash or timeout)"
    exit 1
fi

if diff -u "$EXPECTED" "$LOG"; then
    echo "PASS [$STEP]"
    exit 0
else
    echo "FAIL [$STEP]: output diff above"
    exit 1
fi
```

---

## run-all.sh

```bash
#!/bin/bash
PASS=0; FAIL=0
for runner in "$(dirname "$0")"/run-step*.sh; do
    bash "$runner" && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
done
echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
```

---

## Populating golden output (first run)

Golden files don't exist until the first verified run. Workflow:

```bash
# 1. Run the test (will fail — no expected file yet)
bash tests/integration/run-step2a.sh

# 2. Review the log manually
cat /tmp/step2a-test.log

# 3. If correct, commit it as the golden file
cp /tmp/step2a-test.log tests/integration/expected/step2a-expected.txt
git add tests/integration/expected/step2a-expected.txt
git commit -m "Add golden output for step2a"
```

---

## Updating golden output intentionally

When a step's behaviour deliberately changes, regenerate the expected file:

```bash
cp /tmp/step2a-test.log tests/integration/expected/step2a-expected.txt
git add tests/integration/expected/step2a-expected.txt
git commit -m "Update step2a golden output: <reason for change>"
```

Never update expected files silently — the commit message must explain why.

---

## Log format contract

Every script's `log()` function must write lines in this format so diffs are
stable and readable:

```
[STEP-NAME] action taken | detail
[STEP-NAME] SKIP: reason | layer name
[STEP-NAME] ERROR: message | line N
[STEP-NAME] Done. N layers processed.
```

Example:
```
[step2a] resize | Horseshoe Bend [WC-LM] -> 690px
[step2a] SKIP: no category code | Orlando Stamp [ST]
[step2a] Done. 26 layers processed.
```

Avoid logging timestamps or absolute paths — those change between runs and
will cause false failures.

---

## Fixture file requirements

Each fixture must contain only the minimum layers needed to exercise the step.
Document the required layer names here as steps are added.

| Step  | App         | Required layers / paths                              |
|-------|-------------|------------------------------------------------------|
| 2a    | Photoshop   | At least one group matching `[Display Name] [WC-LM]` |
| 2b    | Photoshop   | At least one group matching `[Display Name] [WC-LM]` |
| (add more as steps are built)                                           |

---

## Running tests

```bash
npm test          # runs run-all.sh via package.json
# or directly:
bash tests/integration/run-all.sh
```

Tests only run on machines with the target Adobe application installed.
