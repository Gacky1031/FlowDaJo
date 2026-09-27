# Architecture — 0.4.0

FlowDaJo is a separate Windows and macOS desktop application. The original Python sibling is not modified.

## Interactive path

`src/main.ts` manages the desktop UI, worksheet tabs, sample selection, import/export, compensation and bounded undo history. `src/model.ts` owns project migration, global population paths and plot defaults. `src/plot.ts` draws scatter/histograms and implements local rectangle/polygon/quadrant gesture previews. `src/jobs.ts` coalesces requests and only publishes results for the most recent revision. Calculation does not disable the UI. A new request retains the last graph only while its sample, population, axes and graph mode match; pending statistics are visibly marked. A stale transform, population or compensation cannot be used to commit a gate.

Each worksheet owns plot cards and statistics/compensation widgets with independent positions and sizes. Worksheets carry a mode field with strict semantics: Global worksheets force cards to the active sample and show one sample, while Normal sheets keep concrete sample bindings and can compare multiple samples and populations on one sheet. Sample selection never changes a Global worksheet into a Normal worksheet. Global population paths are arrays of names from root; missing or ambiguous paths produce an explicit per-card error. The UI keeps selection for bulk edits, Normal-only sample expansion, and mixed plot/widget placement. Grid alignment snaps worksheet items to the nearest grid by default; its dropdown supports an explicit layout for the whole worksheet or selected items. Compensation templates create FSC-A versus selected fluorescence channels. Auto display ranges are synchronized per worksheet mode: Global cards retain the first sample's range, while equivalent Normal cards share the union of their event-derived ranges; explicitly entered ranges win. Parent populations for new gates are taken from each plotted graph. Tree clicks select populations; double-clicking a gate in a plot retains its parent plot and adds a child-population plot. Gates have a global or sample scope and can be moved between scopes from the context menu after channel/conflict validation.

`src-tauri/src/worker.rs` owns one persistent bundled R process. Newline-delimited JSON travels through pipes. A mutex serializes commands outside the UI thread. R failures return structured errors; worker exits, protocol errors and 180-second timeouts clear the worker for restart on the next command. Normal app exit shuts it down. Only listed analysis/file actions are accepted. External R/library settings are overridden by bundled paths.

`r/worker.R` supports persistent and legacy one-shot modes. `r/core.R` retains the tested FCS, compensation, gate and legacy analysis implementation. `r/worksheet.R` supplies interactive worksheet analysis, per-card errors, bounded session caches, histograms and worksheet reports. The session cache retains up to 16 recently used samples within a 512 MiB byte budget (configurable with `FLOWDESK_CACHE_MB`); one oversized active sample remains available. Transformed vectors are cached up to 20 axis definitions per sample. Changes to compensation invalidate transformed vectors/gates/statistics; gate changes invalidate masks/statistics only for affected samples. The health action reports raw reads/hits, compensation/mask/plot builds, elapsed times, cache bytes and evictions. Interactive source checks use file path, stored MD5, size, mtime and ctime. Changed metadata triggers full MD5 verification. Project loading always checks source MD5. This detects ordinary changes, not deliberate same-metadata tampering.

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

The footer shows the saved destination and dirty state. While edits are unsaved, a debounced metadata-only recovery snapshot is kept in the desktop WebView's local storage. On the next launch the user can restore or discard it; a successful explicit project save or project replacement clears the snapshot. Raw FCS event matrices are never included. Local storage capacity and host profile loss still limit recovery, so the explicit project file remains the durable copy.

Worksheet PDF uses the saved A4 page regions, orientation, scale, and worksheet coordinates. Plot, statistics, and compensation widgets inside each page's safe area are included; report export expands active/global cards and widgets across samples and keeps Normal items bound to their selected sample. Missing report populations are represented by a labeled placeholder and are returned in the export result instead of being replaced by a parent population. Optional report statistics and compensation tables are appended as detail pages. `prepare_pdf_preview` generates and merges the actual PDF into a scoped app-cache file, shown inside the desktop dialog through Tauri's asset protocol. `commit_pdf_preview` copies those exact bytes to the chosen destination; cancelling releases the temporary file. The browser-only test bridge retains an approximate preview because it has no Tauri asset protocol.

R/flowCore and fixed WebView2 are bundled exactly as in 0.2.0. Builds include all three R source files. Fixed WebView2 updates require a new app distribution; no initial runtime download or external R installation is needed.

## Test boundaries and remaining features

`tests/worksheet.test.mjs` verifies persistent worker behavior, 12 plots, cache invalidation, missing population errors, fixed/global binding, transforms, histogram totals and project roundtrip. `tests/jobs.test.mjs` verifies request coalescing and stale response suppression. Browser tests use `scripts/test-ui.mjs`, a loopback-only development bridge to real bundled R, with native file dialogs stubbed; this bridge is excluded from production. `scripts/native-smoke.mjs` tests the built executable through its actual Tauri IPC.

FlowJo `.wsp` import, histogram overlays, Boolean gates and automatic single-stain compensation are not implemented. Million-event responsiveness and Windows 10 hardware have not been benchmarked. Windows native WebView drag-and-drop and embedded PDF display still require an interactive application check on a host that allows UI automation.

## Direct axis UI (0.3.1)

`src/axis-ui.ts` owns the axis-label markup, searchable parameter dialog, keyboard selection and validated scale dialog. Draft values do not mutate the project until Apply. The callback in main records one undo snapshot for a plot or worksheet-wide change. Modal dialogs isolate shortcuts from the worksheet. Focus view changes CSS geometry only; saved card positions and sizes are unchanged. See `UI-INTERACTION.md` for controls and references.


## 0.4.0 rendering / interactions

`render-plot.ts` renders seven plot modes on high-DPI canvas without a grid. `gate-hit.ts` tests interiors; `plot.ts` manages gate gestures; `context-menu.ts` and `plot-options.ts` provide operations and style editing. R computes display ticks, log transforms, full-event density grids/equal-mass contour thresholds and statistics. PDF/SVG use the same worksheet payload and Cairo vector devices. `statistics_csv`, `plot_pdf`, `plot_svg`, and `save_template` are allowed worker actions. Density bins are capped at256, histogram bins at512. CDF currently transmits all visible finite X values. Biexponential labeling refers to flowCore Logicle, not FlowJo's proprietary implementation.

Gates have a `scope` of `sample` or `global`. The R session includes global gates when evaluating every sample, while the UI shows them in each active sample's population tree. New gates inherit the selected scope. A gate double-click leaves the parent card at its original coordinates and appends a new child card for the selected population. `standard-expansion` creates the standard FSC-A/SSC-A, FSC-H/FSC-A, and SSC-H/SSC-A cards when those channels are present.


## Worksheet template and report options

The File menu saves and applies `flowdesk-worksheet-template/1` files. Export collects the active worksheet's gate dependencies and source sample metadata but never event data. Apply asks for source→destination sample and detector mappings, validates missing detectors and conflicting same-name gates, remaps gate/card/page identifiers, and adds a new worksheet without replacing existing sheets. Full-sample PDF reports accept independent includePlots, includeStatistics, and includeCompensation flags so a printout can contain only the selected sections. Global worksheets retain one active sample per sheet and their axis definitions while that sample changes; Normal sheets serialize concrete sample bindings for every card.
