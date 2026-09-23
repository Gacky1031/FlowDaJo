# Validation record - 2026-09-12

Environment: Windows x64, R 4.5.1, flowCore 2.20.0, Node 24.3.0, Rust 1.98.1, Tauri 2.11.5. The verified native build uses Rust GNU and the existing Rtools45 compiler, with Rust's self-contained Windows libraries.

| Check | Result |
| --- | --- |
| R numeric, gate, FCS, project and XML tests | 19 passed |
| Node-to-R JSON protocol tests | 3 passed |
| Rust production worker integration tests | 3 passed |
| UI: real R demo, compensation, rectangle and quadrant gates | Passed |
| TypeScript and Vite production build | Passed |
| Windows release EXE and NSIS installer build | Passed |
| Staged EXE: actual Tauri IPC, Rust, bundled R scripts, flowCore, demo and compensation | Passed |
| High-DPI/narrow viewport: settings drawer and worksheet width | Passed; screenshot inspected |
| PDF: three-page A4 landscape report with Japanese text | Rendered and visually inspected |
| Installer script: core.R, worker.R and WebView2Loader.dll | Explicit inclusion verified |

The native smoke test enables a WebView2 debugging port only in that test process, uses a separate synthetic-data profile, and terminates the test app afterward. Normal startup does not enable a debugging port.

Artifacts:
- `release/FlowDesk-Tauri/FlowDesk-Tauri.exe`
- `release/FlowDesk Tauri_0.1.0_x64-setup.exe`
- `release/FlowDesk-Tauri-0.1.0-windows-x64.zip`
- `output/pdf/flowdesk-validation.pdf`
- `artifacts/native-workspace.png` and `artifacts/workspace.png`

Limits of validation: synthetic data and generated FCS/XML fixtures were used. Actual BD DIVA exports and a clean Windows machine without the preinstalled R environment have not been tested. The installer was built and its resource manifest checked; it was not installed into the user's normal application directory. R/flowCore is an external runtime dependency.

No files under the existing sibling `../flowdesk` were edited.
