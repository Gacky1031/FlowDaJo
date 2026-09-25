# Import the editable parts of BD FACSDiva experiment XML exports.
diva_text <- function(node, xpath, default = NULL) {
  value <- xml2::xml_find_first(node, xpath)
  if (inherits(value, "xml_missing")) return(default)
  value <- xml2::xml_text(value)
  if (!length(value) || !nzchar(trimws(value))) default else value
}

diva_bool <- function(value, default = FALSE) {
  if (is.null(value) || !length(value) || is.na(value[1])) return(default)
  value <- tolower(trimws(as.character(value[1])))
  if (value %in% c("true", "1", "yes")) return(TRUE)
  if (value %in% c("false", "0", "no")) return(FALSE)
  default
}

diva_num <- function(value, default = NA_real_) {
  out <- suppressWarnings(as.numeric(value))
  if (!length(out) || !is.finite(out[1])) default else out[1]
}

diva_path_parts <- function(value) {
  if (is.null(value) || !nzchar(value)) return(character())
  parts <- strsplit(value, intToUtf8(92), fixed = TRUE)[[1]]
  parts[nzchar(parts)]
}

diva_axis <- function(channel, settings = list()) {
  spec <- settings[[channel]]
  if (is.null(spec)) return(axis_default(channel))
  list(channel = channel,
       scale = if (isTRUE(spec$isLog)) "logicle" else "linear",
       w = spec$w %||% .5, t = spec$t %||% 262144,
       m = spec$m %||% 4.5, a = spec$a %||% 0,
       min = if(isTRUE(spec$isLog)) 0 else 0,
       max = if(isTRUE(spec$isLog)) 4.5 else 262144)
}

diva_width <- function(scale_value) {
  if (!is.finite(scale_value) || scale_value <= 0) return(0)
  max(0, (4.5 - log10(262144 / scale_value)) / 2)
}

diva_axis_values <- function(values, axis, scaled = FALSE, gate_scale = 0) {
  values <- as.numeric(values)
  if (isTRUE(scaled)) {
    if (identical(axis$scale, "linear")) return(values / 4096 * 262144)
    gate_transform <- logicleTransform(w = diva_width(gate_scale), t = 262144,
                                        m = 4.5, a = 0)
    # DIVA can save vertices a little beyond the plot border. The inverse
    # logicle is only defined on the visible 0..4.5 domain.
    position <- pmax(0, pmin(4.5, values / 4096 * 4.5))
    raw <- as.numeric(inverseLogicleTransform(gate_transform)(position))
  } else if (identical(axis$scale, "linear")) return(values)
  else raw <- 10^values
  if (identical(axis$scale, "log")) {
    out <- rep(NA_real_, length(raw)); keep <- is.finite(raw) & raw > 0
    out[keep] <- log10(raw[keep]); return(out)
  }
  as.numeric(logicleTransform(w = axis$w %||% .5, t = axis$t %||% 262144,
                              m = axis$m %||% 4.5, a = axis$a %||% 0)(raw))
}

diva_merge_axis_settings <- function(primary, fallback = list()) {
  for (channel in names(fallback)) {
    if (is.null(primary[[channel]])) {
      primary[[channel]] <- fallback[[channel]]
      next
    }
    for (field in names(fallback[[channel]])) {
      if (is.null(primary[[channel]][[field]]))
        primary[[channel]][[field]] <- fallback[[channel]][[field]]
    }
  }
  primary
}

diva_channel_settings <- function(instrument_settings) {
  result <- list()
  if (inherits(instrument_settings, "xml_missing")) return(result)
  compensation_enabled <- diva_bool(diva_text(instrument_settings, "./compensation_enabled"), FALSE)
  use_auto <- diva_bool(diva_text(instrument_settings, "./use_auto_biexp_scale"), FALSE)
  parameters <- xml2::xml_find_all(instrument_settings, "./parameter")
  for (parameter in parameters) {
    channel <- xml2::xml_attr(parameter, "name")
    if (is.null(channel) || !nzchar(channel)) next
    is_log <- diva_bool(diva_text(parameter, "./is_log"), FALSE)
    manual <- diva_num(diva_text(parameter, "./manual_biexp_scale"), -1)
    automatic <- if (compensation_enabled) {
      c(diva_num(diva_text(parameter, "./comp_biexp_scale"), -1),
        diva_num(diva_text(parameter, "./biexp_scale"), -1))
    } else {
      c(diva_num(diva_text(parameter, "./biexp_scale"), -1),
        diva_num(diva_text(parameter, "./comp_biexp_scale"), -1))
    }
    # DIVA's scale number is an intensity width, not hundredths of a decade.
    # Conversion follows the formula used by CytoML's DIVA parser.
    candidates <- if(use_auto) c(automatic, manual) else c(manual, automatic)
    valid <- candidates[is.finite(candidates) & candidates > 0]
    spec <- list(isLog = is_log, t = 262144, m = 4.5, a = 0)
    if (length(valid)) spec$w <- diva_width(valid[1])
    result[[channel]] <- spec
  }
  result
}

diva_spillover <- function(instrument_settings, frame, enabled_default = FALSE) {
  if (inherits(instrument_settings, "xml_missing")) return(NULL)
  parameters <- xml2::xml_find_all(instrument_settings, "./parameter")
  names <- xml2::xml_attr(parameters, "name")
  coefficients <- lapply(parameters, function(parameter) {
    nodes <- xml2::xml_find_all(parameter, "./compensation/compensation_coefficient")
    suppressWarnings(as.numeric(xml2::xml_text(nodes)))
  })
  valid <- which(lengths(coefficients) > 0 & !is.na(names) & nzchar(names))
  if (length(valid) < 1L) return(NULL)
  n <- length(coefficients[[valid[1]]])
  if (n != length(valid) || any(lengths(coefficients[valid]) != n) || anyDuplicated(names[valid])) return(NULL)
  correction <- matrix(unlist(coefficients[valid], use.names = FALSE), nrow = n,
                      byrow = TRUE, dimnames = list(names[valid], names[valid]))
  available <- if ("flowFrame" %in% class(frame)) channel_names(frame) else as.character(frame)
  channels <- available[available %in% names[valid]]
  if (!length(channels)) return(NULL)
  correction <- correction[channels, channels, drop = FALSE]
  spill <- tryCatch(solve(t(correction)), error = function(e) NULL)
  if (is.null(spill) || any(!is.finite(spill)) || rcond(spill) < 1e-8) return(NULL)
  diagonal <- diag(spill)
  if (any(!is.finite(diagonal)) || any(abs(diagonal) < 1e-12)) return(NULL)
  # FACSDiva stores the per-parameter compensation coefficients as a correction
  # transform. FlowCore expects the forward spillover matrix with unit diagonal.
  spill <- diag(1 / diagonal, nrow = length(diagonal)) %*% spill
  diag(spill) <- 1
  list(enabled = diva_bool(diva_text(instrument_settings, "./compensation_enabled"), enabled_default),
       channels = as.list(channels), values = rows(spill), source = "DIVA XML")
}

diva_gate_import <- function(template, template_name, active, source_hash, template_index,
                             fallback_axis_settings = list()) {
  settings_node <- xml2::xml_find_first(template, "./instrument_settings")
  axis_settings <- diva_merge_axis_settings(diva_channel_settings(settings_node), fallback_axis_settings)
  definitions <- xml2::xml_find_all(template, "./gates/gate")
  imported <- list(); path_ids <- list(); path_names <- list(); warnings <- character()
  for (i in seq_along(definitions)) {
    definition <- definitions[[i]]
    fullname <- xml2::xml_attr(definition, "fullname")
    parts <- diva_path_parts(fullname)
    if (length(parts) < 2L || identical(xml2::xml_attr(definition, "type"), "EventSource_Classifier")) next
    region <- xml2::xml_find_first(definition, "./region")
    if (inherits(region, "xml_missing")) next
    region_type <- toupper(xml2::xml_attr(region, "type") %||% "")
    x_channel <- xml2::xml_attr(region, "xparm") %||% ""
    y_channel <- xml2::xml_attr(region, "yparm") %||% ""
    if (!nzchar(x_channel) || !nzchar(y_channel) && region_type != "INTERVAL_REGION") {
      warnings <- c(warnings, paste0(template_name, ": skipped gate without axis identifiers (", fullname, ")"))
      next
    }
    x_axis <- diva_axis(x_channel, axis_settings)
    y_axis <- if (nzchar(y_channel)) diva_axis(y_channel, axis_settings) else axis_default(x_channel)
    point_nodes <- xml2::xml_find_all(region, "./points/point")
    raw_x <- suppressWarnings(as.numeric(xml2::xml_attr(point_nodes, "x")))
    raw_y <- suppressWarnings(as.numeric(xml2::xml_attr(point_nodes, "y")))
    if (length(raw_x) < 2L || any(!is.finite(raw_x)) || any(!is.finite(raw_y))) {
      warnings <- c(warnings, paste0(template_name, ": skipped gate with invalid coordinates (", fullname, ")"))
      next
    }
    x_scaled <- diva_bool(diva_text(definition, "./is_x_parameter_scaled"), FALSE)
    y_scaled <- diva_bool(diva_text(definition, "./is_y_parameter_scaled"), FALSE)
    x_gate_scale <- diva_num(diva_text(definition, "./x_parameter_scale_value"), 0)
    y_gate_scale <- diva_num(diva_text(definition, "./y_parameter_scale_value"), 0)
    converted <- tryCatch(list(
      x = diva_axis_values(raw_x, x_axis, x_scaled, x_gate_scale),
      y = if (nzchar(y_channel)) diva_axis_values(raw_y, y_axis, y_scaled, y_gate_scale) else raw_y
    ), error = function(e) NULL)
    if (is.null(converted)) {
      warnings <- c(warnings, paste0(template_name, ": skipped gate with invalid DIVA transform (", fullname, ")"))
      next
    }
    x <- converted$x; y <- converted$y
    if (any(!is.finite(x)) || any(!is.finite(y))) {
      warnings <- c(warnings, paste0(template_name, ": skipped gate outside the imported axis range (", fullname, ")"))
      next
    }
    gate_type <- switch(region_type,
      POLYGON_REGION = "polygon",
      RECTANGLE_REGION = "rectangle",
      INTERVAL_REGION = "range",
      ELLIPSE_REGION = "ellipse",
      NULL)
    if (is.null(gate_type)) {
      warnings <- c(warnings, paste0(template_name, ": unsupported DIVA gate type ", region_type, " (", fullname, ")"))
      next
    }
    # Separate older worksheet templates that reuse the same population names.
    gate_parts <- parts[-1]
    if (!active && length(gate_parts)) gate_parts[1] <- paste0(gate_parts[1], " [", template_name, "]")
    parent_parts <- head(gate_parts, -1)
    parent_key <- if (length(parent_parts)) paste(parent_parts, collapse = "\u001f") else "root"
    parent_id <- path_ids[[parent_key]] %||% "root"
    gate_name <- tail(gate_parts, 1)
    id <- paste0("diva-", substr(source_hash, 1, 10), "-t", template_index, "-g", i)
    gate <- list(id = id, sampleId = "diva", name = gate_name, parent = parent_id,
                 type = gate_type, x = x_axis, y = y_axis, scope = "global",
                 divaTemplate = template_name, divaSourceId = substr(source_hash, 1, 10))
    edge <- list()
    if (x_scaled && min(raw_x) <= 0) edge$xMin <- min(x)
    if (x_scaled && max(raw_x) >= 4095) edge$xMax <- max(x)
    if (y_scaled && min(raw_y) <= 0) edge$yMin <- min(y)
    if (y_scaled && max(raw_y) >= 4095) edge$yMax <- max(y)
    if (length(edge)) gate$edgeExtent <- edge
    if (gate_type == "polygon") {
      gate$vertices <- rows(cbind(x, y))
    } else if (gate_type == "range") {
      gate$bounds <- as.list(range(x))
    } else {
      gate$bounds <- as.list(c(min(x), max(x), min(y), max(y)))
    }
    imported[[length(imported) + 1L]] <- gate
    original_key <- paste(parts, collapse = "\u001f")
    new_key <- paste(gate_parts, collapse = "\u001f")
    path_ids[[new_key]] <- id
    path_names[[original_key]] <- gate_parts
  }
  list(gates = imported, pathNames = path_names, axisSettings = axis_settings,
       warnings = warnings)
}

diva_population <- function(name, gate_info, template_name, active) {
  parts <- diva_path_parts(name)
  parts <- parts[!tolower(parts) %in% c("all events", "all events ", "all events")]
  if (!length(parts)) return(character())
  key <- paste(diva_path_parts(name), collapse = "\u001f")
  mapped <- gate_info$pathNames[[key]]
  if (!is.null(mapped)) return(mapped)
  if (!active && length(parts)) parts[1] <- paste0(parts[1], " [", template_name, "]")
  parts
}

diva_worksheet_import <- function(worksheet, template, gate_info, source_hash, index,
                                  active_name, experiment_name,
                                  fallback_axis_settings = list()) {
  name <- xml2::xml_attr(worksheet, "name") %||% paste("DIVA worksheet", index)
  type <- xml2::xml_attr(worksheet, "type") %||% "ANALYSIS_WORKSHEET"
  global <- identical(type, "ACQUISITION_TEMPLATE")
  settings <- if (!inherits(template, "xml_missing")) gate_info$axisSettings else
    diva_merge_axis_settings(diva_channel_settings(xml2::xml_find_first(worksheet, ".//instrument_settings")), fallback_axis_settings)
  template_name <- if (global) name else ""
  is_active <- global && identical(name, active_name)
  elements <- xml2::xml_find_all(worksheet, "./worksheet_element")
  plots <- list(); skipped <- character(); scale <- 1.5
  for (element in elements) {
    kind <- toupper(xml2::xml_attr(element, "type") %||% "")
    if (!grepl("DOTPLOT|HISTOGRAM", kind)) {
      skipped <- c(skipped, kind %||% "unknown")
      next
    }
    plot_node <- xml2::xml_find_first(element, "./plot")
    parameters <- xml2::xml_find_first(plot_node, "./parameters")
    x_channel <- xml2::xml_attr(parameters, "xParam") %||% ""
    y_channel <- xml2::xml_attr(parameters, "yParam") %||% ""
    if (!nzchar(x_channel)) {
      skipped <- c(skipped, paste0(kind, " (no X channel)"))
      next
    }
    mode <- if (grepl("HISTOGRAM", kind)) "histogram" else "scatter"
    if (!nzchar(y_channel)) y_channel <- x_channel
    x_axis <- diva_axis(x_channel, settings)
    y_axis <- diva_axis(y_channel, settings)
    selected <- xml2::xml_find_all(plot_node, "./gate_selections/gate")
    population <- character()
    if (length(selected)) {
      population <- diva_population(xml2::xml_attr(selected[[1]], "name"), gate_info,
                                    template_name, is_active)
    }
    dot <- diva_num(diva_text(plot_node, ".//dot_size"), 0)
    if (!is.finite(dot) || dot <= 0) dot <- 1.6 else dot <- max(.5, min(8, dot))
    plots[[length(plots) + 1L]] <- list(
      id = paste0("diva-", substr(source_hash, 1, 10), "-p", index, "-", length(plots) + 1L),
      x = x_axis, y = y_axis, sampleId = "active", population = as.list(population),
      mode = mode, left = max(0, diva_num(xml2::xml_attr(element, "x"), 0) * scale),
      top = max(0, diva_num(xml2::xml_attr(element, "y"), 0) * scale),
      width = max(260, diva_num(xml2::xml_attr(element, "width"), 219) * scale),
      height = max(240, diva_num(xml2::xml_attr(element, "height"), 213) * scale),
      dotSize = dot, dotOpacity = .6, color = "#146b8c", smoothing = TRUE,
      bins = 128, contourPercent = 10, histogramNormalize = "count")
  }
  sheet_id <- paste0("diva-", substr(source_hash, 1, 10), "-ws", index)
  list(worksheet = list(id = sheet_id,
       name = if (nzchar(experiment_name)) paste0(name, " · ", experiment_name) else name,
       plots = plots, mode = if (global) "global" else "normal", zoom = 1,
       divaTemplate = name, divaSourceId = substr(source_hash, 1, 10)),
       skipped = skipped)
}

parse_diva_xml <- function(xml) {
  text <- paste(readLines(xml, warn = FALSE, encoding = "UTF-8"), collapse = "\n")
  if (grepl("<!DOCTYPE|<!ENTITY", text, ignore.case = TRUE)) fail("DTD/entity declarations are not accepted")
  doc <- xml2::read_xml(text, options = "NONET")
  experiments <- xml2::xml_attr(xml2::xml_find_all(doc,
    "//*[local-name()='experiment' or local-name()='Experiment']"), "name")
  experiments <- experiments[!is.na(experiments) & nzchar(experiments)]
  metadata <- list(file = basename(xml), sourcePath = normalizePath(xml, winslash = "/", mustWork = TRUE),
                   experiments = as.list(experiments))
  if (!identical(tolower(xml2::xml_name(xml2::xml_root(doc))), "bdfacs")) {
    return(list(metadata = metadata, gates = list(), worksheets = list(), divaCompensations = list(), sampleSettings = list(),
                activeWorksheet = NULL, warnings = paste0(basename(xml),
                  ": DIVA gate and worksheet settings are not restored because this is not a FACSDiva experiment export.")))
  }
  experiment <- xml2::xml_find_first(doc, "/bdfacs/experiment")
  if (inherits(experiment, "xml_missing")) fail("FACSDiva XML does not contain an experiment node")
  experiment_name <- xml2::xml_attr(experiment, "name") %||% basename(xml)
  experiment_axis_settings <- diva_channel_settings(xml2::xml_find_first(experiment, "./instrument_settings"))
  config <- xml2::xml_find_first(experiment, "./worksheet_config")
  active_template <- xml2::xml_attr(config, "active_acquisition_template") %||% ""
  active_sheet <- xml2::xml_attr(config, "active_worksheet") %||% ""
  source_hash <- unname(tools::md5sum(xml))
  templates <- xml2::xml_find_all(experiment, "./acquisition_worksheets/worksheet_template")
  worksheets <- xml2::xml_find_all(config, "./worksheet")
  gates <- list(); imported_sheets <- list(); diva_compensations <- list(); warnings <- character()
  visible_names <- vapply(worksheets, function(w) xml2::xml_attr(w, "name") %||% "", "")
  for (i in seq_along(worksheets)) {
    worksheet <- worksheets[[i]]
    name <- xml2::xml_attr(worksheet, "name") %||% ""
    template <- xml2::xml_missing()
    template_index <- NA_integer_
    if (identical(xml2::xml_attr(worksheet, "type"), "ACQUISITION_TEMPLATE")) {
      hits <- which(vapply(templates, function(t) identical(xml2::xml_attr(t, "name"), name), logical(1)))
      if (length(hits)) {
        template_index <- hits[1]
        template <- templates[[template_index]]
      }
    }
    is_active <- nzchar(active_template) && identical(name, active_template)
    if (!inherits(template, "xml_missing")) {
      settings_node <- xml2::xml_find_first(template, "./instrument_settings")
      parameter_nodes <- xml2::xml_find_all(settings_node, "./parameter")
      parameter_names <- xml2::xml_attr(parameter_nodes, "name")
      has_coefficients <- vapply(parameter_nodes, function(parameter)
        length(xml2::xml_find_all(parameter, "./compensation/compensation_coefficient")) > 0L, logical(1))
      available_channels <- parameter_names[has_coefficients & !is.na(parameter_names)]
      preset <- diva_spillover(settings_node, available_channels, FALSE)
      if (!is.null(preset)) {
        preset$id <- paste0("diva-", substr(source_hash, 1, 10), "-c", template_index)
        preset$name <- name
        preset$template <- name
        preset$file <- basename(xml)
        preset$active <- is_active
        preset$divaSourceId <- substr(source_hash, 1, 10)
        diva_compensations[[length(diva_compensations) + 1L]] <- preset
      }
    }
    gate_info <- if (!inherits(template, "xml_missing"))
      diva_gate_import(template, name, is_active, source_hash, template_index,
                       experiment_axis_settings) else
      list(gates = list(), pathNames = list(),
           axisSettings = diva_merge_axis_settings(diva_channel_settings(xml2::xml_find_first(worksheet, ".//instrument_settings")), experiment_axis_settings),
           warnings = character())
    gates <- c(gates, gate_info$gates)
    warnings <- c(warnings, gate_info$warnings)
    result <- diva_worksheet_import(worksheet, template, gate_info, source_hash, i,
                                    active_template, experiment_name, experiment_axis_settings)
    imported_sheets[[length(imported_sheets) + 1L]] <- result$worksheet
    if (length(result$skipped)) warnings <- c(warnings, paste0(name, ": skipped unsupported worksheet elements: ",
      paste(sort(unique(result$skipped)), collapse = ", ")))
    if (!length(result$worksheet$plots) && identical(xml2::xml_attr(worksheet, "type"), "ACQUISITION_TEMPLATE"))
      warnings <- c(warnings, paste0(name, ": no plot elements could be restored"))
  }
  sample_settings <- list()
  specimens <- xml2::xml_find_all(experiment, "./specimen")
  for (specimen in specimens) {
    specimen_name <- xml2::xml_attr(specimen, "name") %||% ""
    for (tube in xml2::xml_find_all(specimen, "./tube")) {
      file <- diva_text(tube, "./data_filename", "")
      if (!nzchar(file)) next
      sample_settings[[length(sample_settings) + 1L]] <- list(
        file = basename(file), expectedPath = file.path(dirname(xml), file),
        specimen = specimen_name, tube = xml2::xml_attr(tube, "name") %||% basename(file),
        instrumentSettings = xml2::xml_find_first(tube, "./instrument_settings"))
    }
  }
  metadata$version <- xml2::xml_attr(xml2::xml_root(doc), "version") %||% ""
  metadata$worksheets <- as.list(visible_names)
  metadata$importedGateCount <- length(gates)
  metadata$importedPlotCount <- sum(vapply(imported_sheets, function(w) length(w$plots), integer(1)))
  metadata$importedCompensationCount <- length(diva_compensations)
  active_id <- NULL
  active_index <- which(vapply(imported_sheets, function(w) grepl(paste0("^", active_template, " · "), w$name), logical(1)))
  if (length(active_index)) active_id <- imported_sheets[[active_index[1]]]$id
  if (is.null(active_id) && nzchar(active_sheet)) {
    active_index <- which(vapply(imported_sheets, function(w) grepl(paste0("^", active_sheet, " · "), w$name), logical(1)))
    if (length(active_index)) active_id <- imported_sheets[[active_index[1]]]$id
  }
  if (!length(gates) && !length(imported_sheets))
    warnings <- c(warnings, paste0(basename(xml), ": no gate or worksheet content was found"))
  list(metadata = metadata, gates = gates, worksheets = imported_sheets,
       divaCompensations = diva_compensations, sampleSettings = sample_settings, activeWorksheet = active_id, warnings = warnings)
}
