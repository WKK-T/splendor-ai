# Windows package validation

Run on an actual Windows x64 machine or Windows GitHub Actions runner. The tested game uses its own bundled Python; the host Python only orchestrates extraction and verification.

```powershell
npm install --no-save playwright
python tests/windows/run.py --archive dist/splendor-ai-windows-x64-v1.0.0.zip --output output/windows-validation
```

The browser test automatically locates installed Edge or Chrome. Alternatively set `CHROME_PATH`, or install Playwright Chromium with `npx playwright install chromium`.

The test unpacks into a Chinese path containing spaces, checks the complete file manifest, runs bundled Python startup and all four inference profiles, starts the actual batch launcher with the default port deliberately occupied, checks loopback-only listening, and operates the game through a real browser. It covers four model opponents, independent hints, payments, discards, nobles, full games, cancellation and HTTP input boundaries.

`output/windows-validation/verification.json` is written only after actual Windows execution passes. Supporting JSON, a screenshot and launcher logs are in the same output directory. A fresh output directory is required for each run. Reports identify the actual OS used; a Windows Server runner test is not a claim that physical Windows 10/11 machines were tested.

For a static preflight from another platform:

```sh
python -m pip install packaging
python tests/windows/structure.py /path/to/extracted/windows-package
```

This inspects PE architecture, imported DLLs, MSVC exports and pinned dependency constraints. Its report explicitly records `windows_execution_performed: false`; static inspection does not replace the Windows runtime test.
