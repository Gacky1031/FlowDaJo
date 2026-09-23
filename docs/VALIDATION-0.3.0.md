# Validation — FlowDesk 0.3.0

Date: 2026-09-16. Windows 11 Education x64. R 4.5.1, flowCore 2.20.0. Windows GNU release toolchain with Rtools45. Previous Python and 0.2.0 releases are retained.

## Completed automated checks

- Existing R scientific suite: 19 passed (asymmetric compensation, channel reordering, preserved negative values/raw frame, rectangle/polygon/quadrant masks, parent intersection, cycle rejection, FCS import, source modification detection, project roundtrip and DIVA metadata).
- Rust: 5 passed. Bundled runtime resolution, allowed command list, live R health/analysis, missing-bundle error, persistent worker PID retained after a domain error.
- Node integration/scheduler: 5 passed. Legacy one-shot protocol still works. Latest-state scheduling coalesces rapid changes, never runs concurrent analysis jobs, and rejects stale success/error results. Persistent worksheet test covers 12 cards, caches, compensation/transform/gate invalidation, active versus pinned samples, explicit missing-population errors, all-event histogram totals and worksheet roundtrip.
- Desktop UI transport harness: 2 scenarios passed using real bundled R. Seven cards on one worksheet; rectangle creation/handle editing/Undo; double-click population opening; per-card channels, histogram, range and Logicle parameters; continued input during deliberately delayed analysis; pinned/global sample switching; multiple sheets; save/load including graph results. Polygon handle editing; grouped quadrant movement preserving a 16,000-event partition; card drag/resize; copy of the complete gate hierarchy to another sample.
- TypeScript/Vite production build passed.

## PDF / visual checks

`artifacts/worksheet-12-plots.pdf`: A4 landscape, 4 pages (12 scatter/histogram cards, statistics, compensation matrix). All pages rendered with Poppler and inspected. Worksheet cards print in reading order, six graphs per page, rather than reproducing freeform overlap/position. The browser UI was also inspected through the browser tool and screenshots. The development bridge replaces only native dialog/IPC transport; it is not shipped.

## Timing observation

The first implementation used one nested JSON list per scatter point. Its 12-plot demo request took approximately 9,880 ms. The vector-array implementation, on the same 16,000-event demo with R already started, took about 279–370 ms in isolated Node/R tests (316 ms in the combined suite). This is a developer-machine observation, not a million-event or cross-machine performance guarantee. Interactive jobs remain serialized; stale pending requests are coalesced, but an already-running R command is allowed to finish.

## Boundaries

Windows 10/clean-machine VM tests and million-event stress tests have not been performed. R keeps at most two samples and 20 transformed vectors per sample; this is not a byte-based memory cap. Project load validates FCS MD5; interactive cached reads detect file metadata changes before rehashing. DIVA proprietary XML gates and FlowJo WSP import remain unsupported. See README for remaining features and exact global population-path behavior.
## Native release verification

The actual 0.3.0 EXE was launched with a Windows-only PATH and deliberately invalid external R and WebView2 settings. It reported R_HOME under the portable folder and WebView2 153.0.4234.32. The live UI displayed six cards and created a gate. Real Tauri IPC analyzed 12 cards in 243 ms on the 16,000-event demo, preserved the worker PID, produced a full worksheet report, saved/reloaded all 12 cards, and imported a 16,000-event FCS fixture. The histogram count was 16,000 and there were no worksheet errors. Details: `artifacts/native-0.3-validation.json`.

This is an isolation test on the development PC, not a clean Windows VM test. It confirms which bundled runtimes the EXE actually used.
