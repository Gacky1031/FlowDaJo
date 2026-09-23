# FlowDesk Tauri 0.2.0 bundled runtime validation

Date: 2026-09-13. Host: Windows 11 Education x64, build 10.0.26200. Build: Rust stable Windows GNU with existing Rtools45; Tauri release/NSIS.

## Bundled components

- R 4.5.1 (UCRT), flowCore 2.20.0, and 30 packages in total including base packages. The exact dependency closure is in runtime/r-manifest.json.
- Microsoft WebView2 Fixed Runtime 153.0.4234.32 x64. Its main executable has a valid Microsoft Authenticode signature.
- WebView2Loader.dll, R worker scripts, upstream license files, and 17 matching R/package source archives with SHA256 provenance.

## Completed checks

- R suite: 19 tests passed with the bundled R and only its library in .libPaths(). Includes compensation, negative values, gates, FCS, project restore and PDF/backend behavior.
- Rust suite: 4 tests passed, including bundled R dispatch and missing-runtime rejection without system fallback.
- JSON worker integration: npm test, 3 tests passed using the bundled R.
- TypeScript/Vite production build and Windows GNU native release build passed. NSIS installer generation passed.
- Native production EXE smoke: launched the new portable application with PATH containing only Windows directories and deliberately invalid external R_HOME, R libraries, FLOWDESK_RSCRIPT and WebView2 paths. Health returned R_HOME and flowCorePath inside the portable runtime/R folder, with exactly one bundled R library. The actual browser reported Edg/153.0.4234.32.
- Native UI demo loaded 16,000 events; compensation enabled; narrow-window settings drawer verified.
- Real native Rust/R commands generated an A4 landscape PDF, imported a 16,000-event FCS fixture, saved/restored a project, and re-analyzed the demo.
- PDF: artifacts/bundled-native-report.pdf, 3 pages, 841 x 595 points. All pages rendered with Poppler and visually inspected: plots, statistics, matrix and footer text fit without clipping.

The reproducible native check is scripts/native-smoke.mjs. Runtime environment poisoning is test-only; production does not enable browser remote debugging.

## Distribution verification

- Portable ZIP: 554,966,889 bytes. All 18,021 file entries match the staged directory by name and size; SHA256 also matches for nine critical files including the application, R binaries, flowCore DLL, fixed WebView2 binaries and R workers. Expanded files total 1,160,622,265 bytes.
- NSIS setup: 429,678,487 bytes. Generated installer script includes Rscript, flowCore, fixed WebView2 and corresponding source archives at the expected runtime paths. Download/bootstrapper branches are disabled. The installer itself has not been run in a clean Windows VM.
- Distribution hashes are recorded in release/SHA256SUMS-0.2.0.txt.

## Scope and limitations

The host still has developer-installed R and Evergreen WebView2. The test proves the EXE used the bundled paths and fixed browser despite invalid external settings; it is not a clean-machine VM test. Windows 10 and every hardware/enterprise-policy combination have not been tested. The target is Windows 10/11 x64 with local-drive deployment. Fixed WebView2 does not run from UNC/network shares. End users need neither Node, Rust, Rtools, a separate R installation, nor an initial runtime download.

Scientific algorithms are unchanged from 0.1.0. See historical VALIDATION.md for earlier functional checks and known DIVA XML limitations. Fixed WebView2 does not auto-update; new runtime versions require a new application distribution.
