# Architecture — 0.3.1

FlowDesk is a separate Windows desktop application. The original Python sibling is not modified.

## Interactive path

`src/main.ts` manages the desktop UI, worksheet tabs, sample selection, import/export, compensation and bounded undo history. `src/model.ts` owns project migration, global population paths and plot defaults. `src/plot.ts` draws scatter/histograms and implements local rectangle/polygon/quadrant gesture previews. `src/jobs.ts` coalesces requests and only publishes results for the most recent revision. Calculation does not disable the UI. A new request retains the last graph only while its sample, population, axes and graph mode match; pending statistics are visibly marked. A stale transform, population or compensation cannot be used to commit a gate.

Each worksheet owns an arbitrary list of plot cards with independent axes, population paths, graph modes, positions and sizes. Worksheets carry a mode field with strict semantics: Global worksheets force every card to sampleId: active and show one selected sample, while Normal sheets force every card to a concrete sample id and can compare multiple samples and populations on one sheet. Selecting a fixed sample from a Global card intentionally converts the sheet to Normal. Global population paths are arrays of names from root; missing/ambiguous paths produce an explicit per-card error. The UI keeps a separate selection set for axis changes, Normal-only population plot expansion, and row/column placement; the combined arrange/expand action applies the same grid to source and newly expanded cards. Compensation templates create FSC-A versus every fluorescence channel. Auto display ranges are synchronized per worksheet mode: Global cards retain the first sample's range, while equivalent Normal cards share the union of their ranges; explicitly entered ranges win. Parent populations for new gates are taken from each plotted graph. A single tree click selects a population; a double click opens it on the worksheet. Gates have a global or sample scope and can be moved between scopes from the context menu after channel/conflict validation.

`src-tauri/src/worker.rs` owns one persistent bundled R process. Newline-delimited JSON travels through pipes. A mutex serializes commands outside the UI thread. R failures return structured errors; worker exits, protocol errors and 180-second timeouts clear the worker for restart on the next command. Normal app exit shuts it down. Only listed analysis/file actions are accepted. External R/library settings are overridden by bundled paths.

`r/worker.R` supports persistent and legacy one-shot modes. `r/core.R` retains the tested FCS, compensation, gate and legacy analysis implementation. `r/worksheet.R` supplies interactive worksheet analysis, per-card errors, bounded session caches, histograms and worksheet reports. Raw and compensated frames for at most two samples stay in memory; transformed vectors are cached up to 20 axis definitions per sample. Changes to compensation invalidate transformed vectors/gates/statistics; gate changes invalidate masks/statistics. Interactive source checks use file path, stored MD5, size, mtime and ctime. Changed metadata triggers full MD5 verification. Project loading always checks source MD5. This detects ordinary changes, not deliberate same-metadata tampering.

## Scientific behavior

- flowCore reads FCS, applies asymmetric compensation, transforms fluorescence and evaluates rectangle/polygon masks. Quadrants partition the parent, including equality at the boundary.
- Raw frames are retained; compensation is calculated from raw values and preserves negatives.
- Gates store their creation transform. Changing graph ranges does not change membership. Graphs display/edit only child gates with compatible transforms; the gate editor can open the parent with original axes.
- Scatter graphs use up to 12,000 deterministically selected events. Column arrays replace expensive per-point JSON lists. Counts, medians and histogram bins use all applicable events.
- Statistics are cached independently from plot layout. Moving/resizing cards is local and does not call R. Tree selection is local. Analysis/plot updates are grouped in a latest-state queue; in-flight R computation is not forcibly cancelled.
- Histograms have 128 bins over the selected display range. Counts outside explicit limits are excluded from those displayed bins; population counts remain the full population.
- Quadrant gates share a group id so moving the center updates all four siblings atomically. Scope conversion moves the selected gate branch (and quadrant peers) together; conversion checks detector availability and duplicate population names.

## Persistence and reports

`flowdesk-r/1` gains additive `worksheets` and `activeWorksheet` fields. Legacy projects migrate their first sample's plot definitions into a global worksheet. Original FCS paths/MD5, sample-specific gates and compensation remain in the project. Runtime caches and undo history are not persisted.

Worksheet PDF arranges every card in reading order into A4 landscape pages of six graphs. It does not reproduce arbitrary overlapping/freeform card positions. Full-sample reports apply the current global template to all samples, append pinned cards once, then append sample statistics and spillover tables. Missing paths/channels abort export instead of substituting root. The legacy PDF action remains available for compatibility.

R/flowCore and fixed WebView2 are bundled exactly as in 0.2.0. Builds include all three R source files. Fixed WebView2 updates require a new app distribution; no initial runtime download or external R installation is needed.

## Test boundaries and remaining features

`tests/worksheet.test.mjs` verifies persistent worker behavior, 12 plots, cache invalidation, missing population errors, fixed/global binding, transforms, histogram totals and project roundtrip. `tests/jobs.test.mjs` verifies request coalescing and stale response suppression. Browser tests use `scripts/test-ui.mjs`, a loopback-only development bridge to real bundled R, with native file dialogs stubbed; this bridge is excluded from production. `scripts/native-smoke.mjs` tests the built executable through its actual Tauri IPC.

No `.wsp` import, proprietary DIVA gate reconstruction, histogram overlays, density/contour plots, histogram range/Boolean/ellipse gates, automatic single-stain compensation or exact freeform report printing is implemented. Million-event responsiveness and Windows 10 hardware have not been benchmarked. Cache limits are by sample/axis count rather than byte budget.

## Direct axis UI (0.3.1)

`src/axis-ui.ts` owns the axis-label markup, searchable parameter dialog, keyboard selection and validated scale dialog. Draft values do not mutate the project until Apply. The callback in main records one undo snapshot for a plot or worksheet-wide change. Modal dialogs isolate shortcuts from the worksheet. Focus view changes CSS geometry only; saved card positions and sizes are unchanged. See `UI-INTERACTION.md` for controls and references.


## 0.4.0 rendering / interactions

`render-plot.ts` renders seven plot modes on high-DPI canvas without a grid. `gate-hit.ts` tests interiors; `plot.ts` manages gate gestures; `context-menu.ts` and `plot-options.ts` provide operations and style editing. R computes display ticks, log transforms, full-event density grids/equal-mass contour thresholds and statistics. PDF/SVG use the same worksheet payload and Cairo vector devices. `statistics_csv`, `plot_pdf`, `plot_svg`, and `save_template` are allowed worker actions. Density bins are capped at256, histogram bins at512. CDF currently transmits all visible finite X values. Biexponential labeling refers to flowCore Logicle, not FlowJo's proprietary implementation.

Gates have a `scope` of `sample` or `global`. The R session includes global gates when evaluating every sample, while the UI shows them in each active sample's population tree. New gates inherit the selected scope. A gate double-click leaves the parent card at its original coordinates and appends a new child card for the selected population. `standard-expansion` creates the standard FSC-A/SSC-A, FSC-H/FSC-A, and SSC-H/SSC-A cards when those channels are present.


## Worksheet template and report options

The toolbar can serialize only the active worksheet layout and gate definitions as flowdesk-worksheet-template/1; sample event data is never included. Full-sample PDF reports accept independent includePlots, includeStatistics, and includeCompensation flags so a printout can contain only the selected sections. Global worksheets retain one active sample per sheet and their axis definitions while that sample changes; Normal sheets serialize concrete sample bindings for every card.
