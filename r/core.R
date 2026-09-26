suppressPackageStartupMessages(library(flowCore))
`%||%` <- function(x, y) if (is.null(x) || length(x) == 0) y else x
fail <- function(message) stop(message, call. = FALSE)
version_info <- function() list(r = R.version.string, flowCore = as.character(packageVersion("flowCore")), engine = "R / flowCore", rHome = normalizePath(R.home(),winslash="/"), libraryPaths = as.list(normalizePath(.libPaths(),winslash="/")), flowCorePath = normalizePath(find.package("flowCore"),winslash="/"))
rows <- function(x) lapply(seq_len(nrow(x)), function(i) unname(as.list(x[i, ])))
matrix_from <- function(x) do.call(rbind, lapply(x, function(r) as.numeric(unlist(r))))
channel_names <- function(f) unname(colnames(exprs(f)))
gate_applies_to_sample <- function(g, sample_id) {
  identical(g$sampleId, sample_id) || identical(g$scope, "global")
}
check_project <- function(p) {
  if (!identical(p$schema, "flowdesk-r/1")) fail("Unsupported project format")
  ids <- vapply(p$samples, function(s) s$id, "")
  if (anyDuplicated(ids)) fail("Duplicate sample identifiers")
  p
}

demo_frame <- function(seed = 42L, n = 16000L) {
  set.seed(seed)
  group <- sample(1:3, n, replace = TRUE, prob = c(.48, .32, .20))
  truth <- cbind(pmax(1000, rnorm(n, c(48000, 92000, 155000)[group], 14000)),
                 pmax(500, rnorm(n, c(18000, 49000, 103000)[group], 9500)),
                 rnorm(n, c(450, 14000, 450)[group], 320),
                 rnorm(n, c(250, 350, 23000)[group], 250),
                 rnorm(n, c(300, 11000, 17000)[group], 310))
  colnames(truth) <- c("FSC-A", "SSC-A", "FITC-A", "PE-A", "APC-A")
  spill <- matrix(c(1,.13,.02, .025,1,.07, .01,.035,1), 3, byrow = TRUE,
                  dimnames = list(colnames(truth)[3:5], colnames(truth)[3:5]))
  truth[, 3:5] <- truth[, 3:5] %*% spill
  flowFrame(truth, description = list(`$SPILLOVER` = spill, GUID = paste0("demo-", seed), DEMO = "Synthetic, not experimental data"))
}

read_frame <- function(s, storage) {
  if (identical(s$kind, "demo")) return(demo_frame(as.integer(s$seed)))
  path <- s$path
  if (is.null(path) || !file.exists(path)) fail(paste("Source FCS is missing:", path))
  hash <- unname(tools::md5sum(path))
  if (!identical(hash, s$md5)) fail(paste("Source FCS changed since import:", basename(path)))
  cache <- file.path(storage, paste0(hash, ".rds"))
  if (file.exists(cache)) return(readRDS(cache))
  f <- read.FCS(path, transformation = "linearize", alter.names = FALSE, truncate_max_range = FALSE)
  if (anyDuplicated(channel_names(f))) fail("Duplicate PnN detector identifiers are not supported")
  if (any(!is.finite(exprs(f)))) fail("FCS contains non-finite events")
  dir.create(storage, showWarnings = FALSE, recursive = TRUE)
  # Unique temporary file makes concurrent analyses safe.
  tmp <- tempfile(tmpdir = storage); saveRDS(f, tmp)
  if (!file.exists(cache)) file.rename(tmp, cache)
  if (file.exists(tmp)) unlink(tmp)
  f
}

spill_config <- function(f) {
  keys <- keyword(f)
  s <- keys[["$SPILLOVER"]] %||% keys[["SPILL"]] %||% keys[["$SPILL"]]
  if (is.character(s)) {
    parts <- strsplit(s, ",", fixed = TRUE)[[1]]
    n <- suppressWarnings(as.integer(parts[1]))
    if (!is.na(n) && length(parts) == 1 + n + n * n) {
      s <- matrix(as.numeric(parts[(n + 2):length(parts)]), n, byrow = TRUE, dimnames = list(parts[2:(n + 1)], parts[2:(n + 1)]))
    } else s <- NULL
  }
  if (!is.matrix(s)) {
    channels <- channel_names(f)[!grepl("^(FSC|SSC|Time)", channel_names(f), ignore.case = TRUE)]
    if (!length(channels)) channels <- channel_names(f)
    s <- diag(length(channels)); dimnames(s) <- list(channels, channels)
  }
  apply_flag <- tolower(as.character(keys[["APPLY COMPENSATION"]] %||% ""))
  list(enabled = apply_flag %in% c("true", "1", "yes"),
       channels = as.list(colnames(s)), values = rows(s), source = "FCS spillover")
}

describe_sample <- function(s, f) {
  channels <- channel_names(f)
  metadata <- pData(parameters(f))
  s$name <- s$name %||% basename(s$path)
  s$events <- nrow(exprs(f))
  s$channels <- lapply(seq_along(channels), function(i) list(id = channels[i], label = if (is.na(metadata$desc[i]) || !nzchar(metadata$desc[i])) channels[i] else paste(channels[i], metadata$desc[i], sep = " · ")))
  s$compensation <- s$compensation %||% spill_config(f)
  s
}

apply_compensation <- function(f, config) {
  if (!isTRUE(config$enabled)) return(f)
  ch <- unlist(config$channels, use.names = FALSE)
  s <- matrix_from(config$values)
  if (length(ch) < 1 || anyDuplicated(ch) || !all(ch %in% channel_names(f))) fail("Compensation detector names do not match the FCS")
  if (!identical(dim(s), c(length(ch), length(ch))) || any(!is.finite(s))) fail("Invalid compensation matrix")
  if (any(abs(diag(s) - 1) > 1e-9)) fail("Compensation matrix diagonal must be 100%")
  if (rcond(s) < 1e-8) fail("Compensation matrix is singular or numerically unstable")
  dimnames(s) <- list(ch, ch)
  # flowCore convention: measured = true %*% spillover. Never mutate the raw frame.
  compensate(f, spillover = s)
}

axis_default <- function(ch) list(channel = ch, scale = if (grepl("^(FSC|SSC|Time)", ch, ignore.case = TRUE)) "linear" else "logicle", w = .5, t = 262144, m = 4.5, a = 0)
axis_values <- function(f, axis) {
  if (!axis$channel %in% channel_names(f)) fail(paste("Unknown axis:", axis$channel))
  x <- exprs(f)[, axis$channel]
  if (identical(axis$scale, "linear")) return(x)
  if (identical(axis$scale, "log")) {
    # Nonpositive values have no logarithm. Plot rendering pins them to the
    # visible minimum; only an edge-reaching gate may include them.
    out <- rep(NA_real_,length(x)); keep <- is.finite(x) & x > 0
    out[keep] <- log10(x[keep]); return(out)
  }
  if (!identical(axis$scale, "logicle")) fail("Unknown axis transformation")
  trans <- logicleTransform(w = axis$w %||% .5, t = axis$t %||% 262144, m = axis$m %||% 4.5, a = axis$a %||% 0)
  trans(x)
}
default_plots <- function(ch) {
  pairs <- list(c(1, min(2, length(ch))), c(min(3, length(ch)), min(4, length(ch))), c(min(3, length(ch)), length(ch)), c(min(4, length(ch)), length(ch)))
  lapply(seq_along(pairs), function(i) list(id = paste0("plot", i), x = axis_default(ch[pairs[[i]][1]]), y = axis_default(ch[pairs[[i]][2]])))
}

gate_masks <- function(f, gates) {
  n <- nrow(exprs(f)); masks <- list(root = rep(TRUE, n)); visiting <- character()
  ids <- vapply(gates, function(g) g$id, "")
  if (anyDuplicated(ids) || "root" %in% ids || any(!nzchar(ids))) fail("Duplicate or invalid gate identifiers")
  evaluate <- function(id) {
    if (!is.null(masks[[id]])) return(masks[[id]])
    if (id %in% visiting) fail("Gate hierarchy contains a cycle")
    ix <- match(id, ids); if (is.na(ix)) fail(paste("Missing parent gate:", id))
    visiting <<- c(visiting, id); g <- gates[[ix]]
    parent <- evaluate(g$parent %||% "root")
    xv <- axis_values(f, g$x)
    # flowFrame rejects a constant synthetic parameter range, so provide a
    # harmless finite ramp for the unused y coordinate of a 1-D range gate.
    yv <- if (identical(g$type, "range")) seq(0, 1, length.out=length(xv)) else axis_values(f, g$y)
    # A gate drawn to the displayed edge includes the events represented by
    # the dots pinned to that edge. Keep the visible gate geometry unchanged.
    edge <- g$edgeExtent %||% list()
    if (identical(g$x$scale,"log") && !is.null(edge$xMin)) xv[!is.finite(xv)] <- as.numeric(edge$xMin)
    if (!identical(g$type,"range") && identical(g$y$scale,"log") && !is.null(edge$yMin)) yv[!is.finite(yv)] <- as.numeric(edge$yMin)
    if (!is.null(edge$xMin)) xv <- pmax(xv, as.numeric(edge$xMin))
    if (!is.null(edge$xMax)) xv <- pmin(xv, as.numeric(edge$xMax))
    if (!identical(g$type, "range")) {
      if (!is.null(edge$yMin)) yv <- pmax(yv, as.numeric(edge$yMin))
      if (!is.null(edge$yMax)) yv <- pmin(yv, as.numeric(edge$yMax))
    }
    xy <- cbind(xv, yv); colnames(xy) <- c("x", "y")
    finite_xy <- is.finite(xy[,1]) & is.finite(xy[,2])
    if (identical(g$type, "rectangle")) {
      b <- as.numeric(unlist(g$bounds)); if (length(b) != 4 || any(!is.finite(b)) || b[1] >= b[2] || b[3] >= b[4]) fail("Invalid rectangle gate")
      frame <- flowFrame(xy[finite_xy,,drop=FALSE])
      filter <- rectangleGate(filterId = id, .gate = list(x = b[1:2], y = b[3:4]))
      inside <- rep(FALSE,n); inside[finite_xy] <- as(filter(frame, filter), "logical")
    } else if (identical(g$type, "polygon")) {
      v <- matrix_from(g$vertices); if (nrow(v) < 3 || ncol(v) != 2 || any(!is.finite(v))) fail("Polygon needs at least three finite vertices")
      colnames(v) <- c("x", "y")
      frame <- flowFrame(xy[finite_xy,,drop=FALSE])
      inside <- rep(FALSE,n); inside[finite_xy] <- as(filter(frame, polygonGate(filterId = id, .gate = v)), "logical")
    } else if (identical(g$type, "ellipse")) {
      b <- as.numeric(unlist(g$bounds)); if (length(b) != 4 || any(!is.finite(b)) || b[1] >= b[2] || b[3] >= b[4]) fail("Invalid ellipse gate")
      cx <- mean(b[1:2]); cy <- mean(b[3:4]); rx <- diff(b[1:2])/2; ry <- diff(b[3:4])/2
      inside <- ((xy[,1]-cx)/rx)^2 + ((xy[,2]-cy)/ry)^2 <= 1
    } else if (identical(g$type, "range")) {
      b <- as.numeric(unlist(g$bounds)); if (length(b) != 2 || any(!is.finite(b)) || b[1] >= b[2]) fail("Invalid range gate")
      inside <- xy[,1] >= b[1] & xy[,1] <= b[2]
    } else if (identical(g$type, "quadrant")) {
      b <- as.numeric(unlist(g$center)); if (length(b) != 2 || any(!is.finite(b)) || !g$quadrant %in% 1:4) fail("Invalid quadrant gate")
      # Equality belongs to upper/right, so all four children partition the parent.
      right <- xy[,1] >= b[1]; upper <- xy[,2] >= b[2]
      inside <- switch(as.character(g$quadrant), `1` = !right & upper, `2` = right & upper, `3` = !right & !upper, `4` = right & !upper)
    } else fail("Unsupported gate type")
    inside[is.na(inside) | !is.finite(xy[,1]) | !is.finite(xy[,2])] <- FALSE
    masks[[id]] <<- parent & inside; visiting <<- setdiff(visiting, id)
    masks[[id]]
  }
  for (id in ids) evaluate(id)
  masks
}

analyze <- function(p, sample_id, storage, include_internal = FALSE) {
  p <- check_project(p)
  ix <- match(sample_id, vapply(p$samples, function(s) s$id, ""))
  if (is.na(ix)) fail("No sample selected")
  s <- p$samples[[ix]]; raw <- read_frame(s, storage); f <- apply_compensation(raw, s$compensation)
  gates <- Filter(function(g) gate_applies_to_sample(g, s$id), p$gates %||% list())
  masks <- gate_masks(f, gates)
  stats <- lapply(c(list(list(id = "root", name = "All events", parent = NULL)), gates), function(g) {
    count <- sum(masks[[g$id]]); parent <- sum(masks[[g$parent %||% "root"]])
    medians <- if (count) apply(exprs(f)[masks[[g$id]], , drop = FALSE], 2, median) else rep(NA_real_, ncol(exprs(f)))
    names(medians) <- channel_names(f)
    list(id = g$id, name = g$name, parent = g$parent, count = count, percentParent = if (parent) 100 * count / parent else NULL,
         percentTotal = if (nrow(exprs(f))) 100 * count / nrow(exprs(f)) else NULL, medians = as.list(medians))
  })
  selected <- p$selectedGate %||% "root"; if (is.null(masks[[selected]])) selected <- "root"
  pool <- which(masks[[selected]])
  index <- if (length(pool) > 20000) pool[unique(round(seq(1, length(pool), length.out = 20000)))] else pool
  plots <- s$plots %||% default_plots(channel_names(f))
  plot_data <- lapply(plots, function(plot) {
    x <- axis_values(f, plot$x); y <- axis_values(f, plot$y)
    limits <- function(v) { r <- if (length(v)) range(v, finite = TRUE) else c(0,1); if (diff(r) == 0) r <- r + c(-.5,.5); r + c(-1,1) * diff(r) * .025 }
    list(id = plot$id, x = plot$x, y = plot$y, xRange = as.list(limits(x)), yRange = as.list(limits(y)),
         points = rows(cbind(x[index], y[index])), shown = length(index), total = length(pool))
  })
  result <- list(sample = s, stats = stats, plots = plot_data, selectedGate = selected, compensationEnabled = isTRUE(s$compensation$enabled), engine = version_info())
  if (include_internal) result$internal <- list(frame = f, masks = masks, gates = gates)
  result
}

import_samples <- function(req) {
  paths <- unlist(req$paths, use.names = FALSE); warnings <- character(); xmls <- character()
  files <- character()
  for (path in paths) {
    if (dir.exists(path)) {
      files <- c(files, list.files(path, pattern = "\\.fcs$", recursive = TRUE, full.names = TRUE, ignore.case = TRUE))
      xmls <- c(xmls, list.files(path, pattern = "\\.xml$", recursive = TRUE, full.names = TRUE, ignore.case = TRUE))
    } else if (grepl("\\.xml$", path, ignore.case = TRUE)) {
      xmls <- c(xmls, path)
      files <- c(files, list.files(dirname(path), pattern = "\\.fcs$", full.names = TRUE, ignore.case = TRUE))
    } else files <- c(files, path)
  }
  xmls <- unique(xmls[file.exists(xmls)])
  diva_imports <- list()
  for (xml in xmls) {
    tryCatch({
      imported <- parse_diva_xml(xml)
      diva_imports[[length(diva_imports) + 1L]] <- imported
      if (length(imported$warnings)) warnings <- c(warnings, imported$warnings)
    }, error = function(e) { warnings <<- c(warnings, paste(basename(xml), conditionMessage(e))) })
  }
  files <- unique(normalizePath(files, winslash = "/", mustWork = TRUE))
  if (!length(files)) fail("No FCS files found")
  diva_order <- character()
  for (diva in diva_imports) for (entry in diva$sampleSettings) {
    expected <- if (file.exists(entry$expectedPath)) normalizePath(entry$expectedPath, winslash = "/", mustWork = TRUE) else ""
    exact <- if (nzchar(expected)) files[tolower(files) == tolower(expected)] else character()
    by_name <- files[tolower(basename(files)) == tolower(entry$file)]
    candidate <- if (length(exact)) exact[1] else if (length(by_name)) by_name[1] else ""
    if (nzchar(candidate)) diva_order <- c(diva_order, candidate)
  }
  diva_order <- unique(diva_order)
  files <- c(diva_order, files[!tolower(files) %in% tolower(diva_order)])
  samples <- list()
  for (file in files) {
    tryCatch({
      if (!grepl("\\.fcs$", file, ignore.case = TRUE)) fail("Only FCS files are accepted")
      hash <- unname(tools::md5sum(file))
      s <- list(id = paste0("s-", hash, "-", length(samples) + 1), kind = "fcs", path = file, md5 = hash, name = basename(file))
      f <- read_frame(s, req$storage)
      s <- describe_sample(s, f)
      matched <- NULL
      for (diva in diva_imports) {
        if (!length(diva$sampleSettings)) next
        for (entry in diva$sampleSettings) {
          expected <- if (file.exists(entry$expectedPath)) normalizePath(entry$expectedPath, winslash = "/", mustWork = TRUE) else ""
          same_path <- nzchar(expected) && identical(tolower(expected), tolower(file))
          same_name <- identical(tolower(entry$file), tolower(basename(file)))
          if (same_path || same_name) { matched <- entry; break }
        }
        if (!is.null(matched)) break
      }
      if (!is.null(matched)) {
        label <- c(matched$specimen, matched$tube); label <- label[nzchar(label)]
        if (length(label)) s$name <- paste(label, collapse = " / ")
        imported_comp <- diva_spillover(matched$instrumentSettings, f, s$compensation$enabled)
        if (!is.null(imported_comp)) s$compensation <- imported_comp
        else warnings <- c(warnings, paste0(basename(file), ": DIVA compensation could not be mapped to FCS channels; retained the FCS matrix."))
      }
      samples[[length(samples) + 1]] <- s
    }, error = function(e) { warnings <<- c(warnings, paste(basename(file), conditionMessage(e))) })
  }
  if (!length(samples)) fail(paste(warnings, collapse = "\n"))
  diva_metadata <- lapply(diva_imports, function(x) x$metadata)
  diva_gates <- unlist(lapply(diva_imports, function(x) x$gates), recursive = FALSE)
  diva_worksheets <- unlist(lapply(diva_imports, function(x) x$worksheets), recursive = FALSE)
  diva_compensations <- unlist(lapply(diva_imports, function(x) x$divaCompensations), recursive = FALSE)
  active_worksheet <- NULL
  for (diva in diva_imports) if (!is.null(diva$activeWorksheet)) { active_worksheet <- diva$activeWorksheet; break }
  list(samples = samples, warnings = as.list(warnings), divaMetadata = diva_metadata,
       divaGates = diva_gates, divaWorksheets = diva_worksheets,
       divaCompensations = diva_compensations, divaActiveWorksheet = active_worksheet)
}
export_pdf <- function(p, storage, path) {
  if (!grepl("\\.pdf$", path, ignore.case = TRUE)) fail("PDF output must end in .pdf")
  if (!length(p$samples)) fail("No samples to export")
  results <- lapply(p$samples, function(s) analyze(p, s$id, storage, TRUE))
  tmp <- tempfile(tmpdir = dirname(path), fileext = ".pdf")
  grDevices::cairo_pdf(tmp, width = 11.69, height = 8.27, family = if (.Platform$OS.type == "windows") "Yu Gothic" else "sans", onefile = TRUE)
  closed <- FALSE; on.exit({ if (!closed) dev.off(); if (file.exists(tmp)) unlink(tmp) }, add = TRUE)
  for (a in results) {
    par(mfrow = c(2,2), mar = c(4,4,3,1), oma = c(2,1,3,1), bg = "white")
    for (plot in a$plots) {
      points <- matrix_from(plot$points)
      plot(NA, xlim = unlist(plot$xRange), ylim = unlist(plot$yRange), xlab = paste(plot$x$channel, plot$x$scale), ylab = paste(plot$y$channel, plot$y$scale), main = paste(a$sample$name, "|", a$selectedGate))
      grid(col = "#eeeeee")
      if (length(points)) points(points[,1], points[,2], pch = 16, cex = .22, col = adjustcolor("#087f8c", alpha.f = .25))
      for (g in a$internal$gates) {
        if (!identical(g$x, plot$x) || !identical(g$y, plot$y)) next
        if (g$type == "rectangle") { b <- unlist(g$bounds); rect(b[1],b[3],b[2],b[4],border = "#dc7019",lwd = 1.3) }
        if (g$type == "polygon") polygon(matrix_from(g$vertices), border = "#dc7019", lwd = 1.3)
        if (g$type == "quadrant") abline(v = g$center[[1]], h = g$center[[2]], col = "#dc7019")
      }
    }
    mtext(paste("FlowDesk Tauri |", p$name, "| Compensation", if (a$compensationEnabled) "ON" else "OFF"), outer = TRUE, side = 3, line = .5, font = 2)
    mtext("Plot coordinates: linear / fixed logicle (w=0.5, t=262144, m=4.5, a=0). Plots sampled to 20,000; statistics use all events.", outer = TRUE, side = 1, cex = .65)
    chunks <- split(a$stats, ceiling(seq_along(a$stats)/14))
    for (chunk in chunks) {
      par(mfrow = c(1,1), mar = c(2,2,3,2)); plot.new(); plot.window(xlim = c(0,1), ylim = c(0,1))
      title(paste("Population statistics |", a$sample$name))
      text(c(.02,.52,.72,.91), .94, c("Population / parent", "Events", "% parent", "% total"), adj = c(0, .5), font = 2, cex = .9)
      y <- .89
      for (row in chunk) {
        segments(.02,y-.022,.98,y-.022,col = "#eeeeee")
        text(.02,y,paste(substr(row$name,1,32),"/",row$parent %||% "-"),adj=0,cex=.85)
        text(c(.52,.72,.91),y,c(format(row$count,big.mark=","),if(is.null(row$percentParent)) "NA" else sprintf("%.2f",row$percentParent),if(is.null(row$percentTotal)) "NA" else sprintf("%.2f",row$percentTotal)),adj=0,cex=.85)
        y <- y-.041
      }
      note_lines <- strwrap(p$notes %||% "", width=115)
      if(length(note_lines)>3) note_lines <- c(note_lines[1:2], "[Additional notes are saved in the project JSON.]")
      text(.02,.23,paste("Notes:", paste(note_lines, collapse="\n")),adj=c(0,1),cex=.65)
      text(.02,.115,paste(strwrap(paste("Source:", a$sample$path %||% "SYNTHETIC DEMO"),width=145),collapse="\n"),adj=c(0,1),cex=.6)
      text(.02,.055,paste("MD5:",a$sample$md5 %||% paste("seed",a$sample$seed),"|",version_info()$r,"| flowCore",version_info()$flowCore),adj=0,cex=.65)
      text(.02,.02,paste("Generated",format(Sys.time(),"%Y-%m-%d %H:%M %Z"),"| Research analysis; verify experimental controls."),adj=0,cex=.65)
    }
    config <- a$sample$compensation
    ch <- unlist(config$channels); s <- matrix_from(config$values) * 100
    par(mfrow=c(1,1),mar=c(3,3,4,3)); plot.new(); plot.window(xlim=c(0,1),ylim=c(0,1))
    title(paste("Spillover matrix (%) |", a$sample$name, "|", if(a$compensationEnabled) "APPLIED" else "NOT APPLIED"))
    # Split large matrices into readable pages rather than shrinking text.
    groups <- split(seq_along(ch), ceiling(seq_along(ch)/8))
    first <- TRUE
    for (rg in groups) for (cg in groups) {
      if (!first) { plot.new(); plot.window(xlim=c(0,1),ylim=c(0,1)); title(paste("Spillover matrix (%) |",a$sample$name)) }; first <- FALSE
      xs <- seq(.25,.95,length.out=length(cg)); ys <- seq(.80,.20,length.out=length(rg))
      text(.02,.94,"Rows: source fluorochrome detector; columns: measured detector",adj=0,cex=.85)
      text(xs,.87,ch[cg],cex=.72)
      for (i in seq_along(rg)) { text(.02,ys[i],ch[rg[i]],adj=0,cex=.8); text(xs,ys[i],sprintf("%.2f",s[rg[i],cg]),cex=.8) }
    }
  }
  dev.off(); closed <- TRUE
  if (!file.copy(tmp, path, overwrite = TRUE)) fail("Cannot write PDF output")
  list(path = normalizePath(path, winslash = "/"), samples = length(results))
}

dispatch <- function(req) {
  dir.create(req$storage, showWarnings = FALSE, recursive = TRUE)
  switch(req$action,
    health = version_info(),
    demo = { f <- demo_frame(); list(samples = list(describe_sample(list(id = "demo-42", kind = "demo", name = "Demo · 3 populations", seed = 42L), f)), warnings = list("Synthetic demo data, not experimental measurements.")) },
    import = import_samples(req),
    analyze = analyze(req$project, req$sampleId, req$storage),
    pdf = export_pdf(check_project(req$project), req$storage, req$path),
    save_template = {
      if (!grepl("\\.json$", req$path, ignore.case=TRUE)) fail("Worksheet template output must end in .json")
      t <- req$template
      if (!is.list(t) || !identical(t$schema, "flowdesk-worksheet-template/1") || is.null(t$worksheet)) fail("Invalid worksheet template")
      tmp <- tempfile(tmpdir = dirname(req$path))
      on.exit(if(file.exists(tmp)) unlink(tmp), add = TRUE)
      jsonlite::write_json(t, tmp, auto_unbox = TRUE, null = "null", pretty = TRUE, digits = 16)
      if (!file.copy(tmp, req$path, overwrite = TRUE)) fail("Cannot save worksheet template")
      list(path = req$path)
    },
    load_template = {
      t <- jsonlite::read_json(req$path, simplifyVector = FALSE)
      if (!is.list(t) || !identical(t$schema, "flowdesk-worksheet-template/1") ||
          !is.list(t$worksheet) || is.null(t$worksheet$plots) || is.null(t$gateDefinitions))
        fail("Invalid worksheet template")
      t
    },
    save = {
      if (!grepl("\\.json$", req$path, ignore.case=TRUE)) fail("Project output must end in .json")
      p <- check_project(req$project); p$engine <- version_info()
      tmp <- tempfile(tmpdir = dirname(req$path))
      on.exit(if(file.exists(tmp)) unlink(tmp), add = TRUE)
      jsonlite::write_json(p, tmp, auto_unbox = TRUE, null = "null", pretty = TRUE, digits = 16)
      if (!file.copy(tmp, req$path, overwrite = TRUE)) fail("Cannot save project")
      list(path = req$path)
    },
    load = {
      p <- check_project(jsonlite::read_json(req$path, simplifyVector = FALSE))
      for (s in p$samples) read_frame(s, req$storage)
      p
    }, fail("Unknown action")
  )
}
