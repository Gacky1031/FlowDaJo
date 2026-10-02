# Interactive worksheet engine. Keep several Normal-sheet samples within a byte budget.
.sessions <- new.env(parent = emptyenv())
.session_order <- character()
.session_budget <- {
  mb <- suppressWarnings(as.numeric(Sys.getenv("FLOWDESK_CACHE_MB", "512")))
  if (!is.finite(mb) || mb < 32) mb <- 512
  mb * 1024^2
}
.session_limit <- 16L
.cache_metrics <- new.env(parent = emptyenv())
.cache_metrics$rawReads <- 0L
.cache_metrics$rawHits <- 0L
.cache_metrics$compensations <- 0L
.cache_metrics$maskBuilds <- 0L
.cache_metrics$plotBuilds <- 0L
.cache_metrics$evictions <- 0L
.cache_metrics$rawSeconds <- 0
.cache_metrics$compensationSeconds <- 0
.cache_metrics$maskSeconds <- 0
.cache_metrics$plotSeconds <- 0
entry_bytes <- function(entry) {
  if (is.null(entry)) return(0)
  parts <- c("raw", "frame", "masks", "stats", "gates", "config")
  sum(vapply(parts, function(key) if (is.null(entry[[key]])) 0 else as.numeric(object.size(entry[[key]])), 0)) +
    if (is.null(entry$axes)) 0 else sum(vapply(ls(entry$axes), function(key) as.numeric(object.size(entry$axes[[key]])), 0))
}
session_cache_bytes <- function() sum(vapply(ls(.sessions), function(id) entry_bytes(.sessions[[id]]), 0))
trim_sessions <- function(protect) {
  while (length(.session_order) > 1L &&
         (length(.session_order) > .session_limit || session_cache_bytes() > .session_budget)) {
    victim <- .session_order[.session_order != protect][1]
    if (is.na(victim)) break
    rm(list = victim, envir = .sessions)
    .session_order <<- .session_order[.session_order != victim]
    .cache_metrics$evictions <- .cache_metrics$evictions + 1L
  }
}
cache_health <- function() {
  as.list(c(as.list(.cache_metrics), list(
    entries = length(.session_order), bytes = session_cache_bytes(),
    budgetBytes = .session_budget, sampleIds = as.list(.session_order))))
}
sample_signature <- function(s) {
  if (identical(s$kind, "demo")) return(list(s$kind, s$seed))
  if (!file.exists(s$path)) fail(paste("Source FCS is missing:", s$path))
  info <- file.info(s$path)
  list(s$path, s$md5, info$size, as.numeric(info$mtime), as.numeric(info$ctime))
}
session_frame <- function(s, storage) {
  sig <- sample_signature(s)
  entry <- .sessions[[s$id]]
  if (is.null(entry) || !identical(entry$signature, sig)) {
    started <- proc.time()[["elapsed"]]
    entry <- list(signature = sig, raw = read_frame(s, storage), config = NULL)
    .cache_metrics$rawReads <- .cache_metrics$rawReads + 1L
    .cache_metrics$rawSeconds <- .cache_metrics$rawSeconds + proc.time()[["elapsed"]] - started
  } else {
    .cache_metrics$rawHits <- .cache_metrics$rawHits + 1L
  }
  if (is.null(entry$frame) || !identical(entry$config, s$compensation)) {
    started <- proc.time()[["elapsed"]]
    entry$frame <- apply_compensation(entry$raw, s$compensation)
    .cache_metrics$compensations <- .cache_metrics$compensations + 1L
    .cache_metrics$compensationSeconds <- .cache_metrics$compensationSeconds + proc.time()[["elapsed"]] - started
    entry$config <- s$compensation
    entry$gates <- NULL; entry$masks <- NULL; entry$stats <- NULL
    entry$axes <- new.env(parent = emptyenv())
  }
  entry$sampleId <- s$id
  .session_order <<- c(setdiff(.session_order, s$id), s$id)
  .sessions[[s$id]] <- entry
  trim_sessions(s$id)
  entry
}
session_analysis <- function(p, s, storage) {
  entry <- session_frame(s, storage)
  gates <- Filter(function(g) gate_applies_to_sample(g, s$id), p$gates %||% list())
  if (is.null(entry$masks) || !identical(entry$gates, gates)) {
    started <- proc.time()[["elapsed"]]
    entry$masks <- gate_masks(entry$frame, gates)
    entry$gates <- gates
    f <- entry$frame; masks <- entry$masks
    entry$stats <- lapply(c(list(list(id = "root", name = "All events", parent = NULL)), gates), function(g) {
      count <- sum(masks[[g$id]]); parent <- sum(masks[[g$parent %||% "root"]])
      medians <- if (count) apply(exprs(f)[masks[[g$id]], , drop = FALSE], 2, median) else setNames(rep(NA_real_, ncol(exprs(f))), channel_names(f))
      list(id=g$id, name=g$name, parent=g$parent, count=count, percentParent=if(parent) 100*count/parent else NULL,
           percentTotal=if(nrow(exprs(f))) 100*count/nrow(exprs(f)) else NULL, medians=as.list(medians))
    })
    .sessions[[s$id]] <- entry
    .cache_metrics$maskBuilds <- .cache_metrics$maskBuilds + 1L
    .cache_metrics$maskSeconds <- .cache_metrics$maskSeconds + proc.time()[["elapsed"]] - started
    trim_sessions(s$id)
  }
  entry
}
resolve_population <- function(gates, path) {
  id <- "root"
  for (name in path %||% list()) {
    candidates <- Filter(function(g) identical(g$parent, id) && identical(g$name, name), gates)
    if (length(candidates) != 1) fail(paste("Population path missing or ambiguous:", paste(unlist(path), collapse=" / ")))
    id <- candidates[[1]]$id
  }
  id
}
cached_axis <- function(entry, axis) {
  key <- jsonlite::toJSON(axis[c("channel","scale","w","t","m","a")], auto_unbox=TRUE)
  if (is.null(entry$axes[[key]])) {
    if (length(ls(entry$axes)) >= 20) rm(list=ls(entry$axes), envir=entry$axes)
    entry$axes[[key]] <- axis_values(entry$frame, axis)
    trim_sessions(entry$sampleId)
  }
  entry$axes[[key]]
}
axis_transform <- function(values, axis, inverse=FALSE) {
  scale <- axis$scale %||% "linear"
  if(identical(scale,"linear")) return(values)
  if(identical(scale,"log")) {
    if(inverse) return(10^values)
    result <- rep(NA_real_,length(values)); positive <- is.finite(values)&values>0
    result[positive] <- log10(values[positive]); return(result)
  }
  tr <- logicleTransform(w=axis$w %||% .5,t=axis$t %||% 262144,m=axis$m %||% 4.5,a=axis$a %||% 0)
  as.numeric(if(inverse) inverseLogicleTransform(tr)(values) else tr(values))
}
same_transform <- function(a,b) identical(a[c("channel","scale","w","t","m","a")],b[c("channel","scale","w","t","m","a")])
project_axis_values <- function(values, source, target, target_range) {
  if(same_transform(source,target)) return(values)
  projected <- axis_transform(axis_transform(values,source,TRUE),target)
  if(identical(target$scale,"log")) projected[!is.finite(projected)] <- target_range[1]
  projected
}
project_gate_geometry <- function(g,card,d) {
  if(same_transform(g$x,card$x) && (g$type=="range" || same_transform(g$y,card$y))) return(g)
  project <- function(vertices) {
    vertices[,1] <- project_axis_values(vertices[,1],g$x,card$x,unlist(d$xRange))
    if(g$type!="range") vertices[,2] <- project_axis_values(vertices[,2],g$y,card$y,unlist(d$yRange))
    vertices
  }
  b <- unlist(g$bounds)
  if(g$type=="ellipse") {
    angle <- seq(0,2*pi,length.out=193L)
    v <- project(cbind(mean(b[1:2])+diff(b[1:2])/2*cos(angle),mean(b[3:4])+diff(b[3:4])/2*sin(angle)))
    g$vertices <- lapply(seq_len(nrow(v)),function(i) as.list(v[i,]))
  } else if(g$type=="polygon") {
    v <- matrix_from(g$vertices)
    dense <- do.call(rbind,lapply(seq_len(nrow(v)),function(i) {
      next_i <- if(i==nrow(v)) 1L else i+1L
      fractions <- (0:47)/48
      cbind(v[i,1]+(v[next_i,1]-v[i,1])*fractions,v[i,2]+(v[next_i,2]-v[i,2])*fractions)
    }))
    dense <- project(dense)
    g$vertices <- lapply(seq_len(nrow(dense)),function(i) as.list(dense[i,]))
  }
  if(length(b)) {
    g$bounds <- as.list(c(project_axis_values(b[1:2],g$x,card$x,unlist(d$xRange)),
      if(g$type!="range") project_axis_values(b[3:4],g$y,card$y,unlist(d$yRange)) else NULL))
  }
  if(g$type=="quadrant") g$center <- as.list(project(matrix(unlist(g$center),nrow=1))[1,])
  g$x <- card$x; if(g$type!="range") g$y <- card$y
  g
}
gate_axis_maps <- function(gates,card,xr,yr) {
  maps <- list(); keys <- character()
  for(side in c("x","y")) {
    if(side=="y" && card$mode %in% c("histogram","cdf")) next
    target <- card[[side]]; target_range <- if(side=="x") xr else yr
    sources <- Filter(function(g) g[[side]]$channel==target$channel && (side=="x" || g$type!="range"),gates)
    for(g in sources) {
      source <- g[[side]]
      if(same_transform(source,target)) next
      key <- jsonlite::toJSON(list(source=source,target=target),auto_unbox=TRUE)
      if(key %in% keys) next
      peers <- Filter(function(peer) same_transform(peer[[side]],source),sources)
      anchors <- unlist(lapply(peers,function(peer) {
        if(peer$type=="polygon") return(vapply(peer$vertices,function(v) v[[if(side=="x")1 else 2]],0))
        if(peer$type=="quadrant") return(peer$center[[if(side=="x")1 else 2]])
        unlist(peer$bounds)[if(side=="x")1:2 else 3:4]
      }),use.names=FALSE)
      display_knots <- seq(target_range[1],target_range[2],length.out=2049L)
      back <- axis_transform(axis_transform(display_knots,target,TRUE),source)
      finite <- c(anchors,back); finite <- finite[is.finite(finite)]
      if(!length(finite)) next
      from <- sort(unique(c(anchors,back,seq(min(finite),max(finite),length.out=1025L))))
      from <- from[is.finite(from)]
      to <- project_axis_values(from,source,target,target_range)
      keep <- is.finite(to); from <- from[keep]; to <- to[keep]
      if(length(from)<2L) next
      # Log pins nonpositive intensities to the visible edge. Drop the resulting
      # plateau below the display domain so inverse pointer mapping is unique.
      if(identical(target$scale,"log")) {
        to <- pmax(target_range[1],to)
        keep <- !duplicated(to,fromLast=TRUE); from <- from[keep]; to <- to[keep]
      }
      maps[[length(maps)+1L]] <- list(source=source,target=target,from=I(from),to=I(to)); keys <- c(keys,key)
    }
  }
  maps
}
display_limits <- function(v, axis) {
  if (!is.null(axis$min) || !is.null(axis$max)) {
    r <- c(axis$min, axis$max)
    if(length(r)!=2 || any(!is.finite(r)) || r[1]>=r[2]) fail("Axis minimum must be smaller than maximum (display coordinates)")
    return(r)
  }
  finite <- v[is.finite(v)]
  if(!length(finite)) return(c(0,1))
  r <- range(finite)
  if(diff(r)==0) r <- r+c(-.5,.5)
  r+c(-1,1)*diff(r)*.025
}
worksheet <- function(req) {
  p <- check_project(req$project)
  cards <- req$plots %||% list()
  widgets <- req$widgets %||% list()
  result <- list(); stats <- list(); errors <- list()
  card_samples <- vapply(cards,function(card) if(identical(card$sampleId,"active")) req$sampleId else card$sampleId,"")
  widget_samples <- vapply(widgets,function(widget) {
    id <- widget$reportSampleId %||% widget$sampleId
    if(is.null(id)||identical(id,"active")) req$sampleId else id
  },"")
  needed <- unique(c(req$sampleId,card_samples,widget_samples))
  needed <- needed[nzchar(needed)]
  for (id in needed) {
    subset <- Filter(function(card) identical(if(identical(card$sampleId,"active")) req$sampleId else card$sampleId,id),cards)
    tryCatch({
      matches <- Filter(function(s) identical(s$id,id),p$samples)
      if(length(matches)!=1) fail("Sample not found")
      s <- matches[[1]]; entry <- session_analysis(p,s,req$storage)
      stats[[id]] <- entry$stats
      for(card in subset) tryCatch({result[[card$id]] <- worksheet_plot(entry,card,s)}, error=function(e) { errors[[card$id]] <<- conditionMessage(e) })
    }, error=function(e) {
      errors[[paste0("sample:",id)]] <<- conditionMessage(e)
      for(card in subset) errors[[card$id]] <<- conditionMessage(e)
    })
  }
  if (length(.session_order)) trim_sessions(tail(.session_order, 1))
  list(plots=result,stats=stats,errors=errors,workerPid=Sys.getpid())
}
axis_suggestion <- function(req) {
  p <- check_project(req$project)
  samples <- Filter(function(s) identical(s$id,req$sampleId),p$samples)
  if(length(samples)!=1L) fail("Sample not found")
  entry <- session_analysis(p,samples[[1]],req$storage)
  id <- resolve_population(entry$gates,req$population %||% list())
  channel <- req$axis$channel
  if(!channel %in% colnames(exprs(entry$frame))) fail("Axis channel not found")
  values <- exprs(entry$frame)[entry$masks[[id]],channel]; values <- values[is.finite(values)]
  if(!length(values)) fail("No finite events in the selected population")
  suggested <- axis_default(channel)
  if(identical(suggested$scale,"logicle")) {
    high <- max(1,as.numeric(quantile(values,.9995)))
    instrument <- range(entry$frame)[2,channel]
    suggested$t <- if(is.finite(instrument)&&instrument>=high&&instrument<=high*100) instrument else high*1.05
    negative <- values[values<0]
    if(length(negative)) suggested$w <- max(0,min(suggested$m/2-.01,
      (suggested$m-log10(suggested$t/abs(as.numeric(quantile(negative,.05)))))/2))
    shown <- axis_transform(values,suggested)
    limits <- display_limits(shown,list())
    suggested$min <- min(0,limits[1]); suggested$max <- max(suggested$m,limits[2])
    reason <- sprintf("蛍光チャンネルの分布と負値（%.1f%%）からBiexponentialの幅・上限・表示範囲を推定しました。",100*mean(values<0))
  } else {
    limits <- display_limits(values,list())
    suggested$min <- if(min(values)>=0) 0 else limits[1]; suggested$max <- limits[2]
    reason <- "FSC・SSC・TimeはLinearで、選択集団の全イベントを含む表示範囲を提案します。"
  }
  suggested$autoRange <- FALSE
  list(axis=suggested,reason=reason,total=length(values))
}
axis_preview <- function(req) {
  p <- check_project(req$project)
  s <- Filter(function(item) identical(item$id, req$sampleId), p$samples)
  if (length(s) != 1L) fail("Sample not found")
  entry <- session_analysis(p, s[[1]], req$storage)
  gate_id <- resolve_population(entry$gates, req$population %||% list())
  values <- cached_axis(entry, req$axis)[entry$masks[[gate_id]]]
  range <- display_limits(values, req$axis)
  nonpositive <- sum(!is.finite(values))
  if(identical(req$axis$scale,"log"))values[!is.finite(values)] <- range[1]
  visible <- values[is.finite(values) & values >= range[1] & values <= range[2]]
  breaks <- seq(range[1], range[2], length.out=65L)
  counts <- hist(visible, breaks=breaks, plot=FALSE, include.lowest=TRUE)$counts
  outside <- sum(!is.finite(values) | values < range[1] | values > range[2])
  warnings <- character()
  if(length(values) && outside/length(values)>.05) warnings <- c(warnings,"5%以上のイベントが表示範囲外です。推奨設定を確認してください。")
  central_span <- if(length(visible)>20L) diff(quantile(visible,c(.01,.99))) else NA_real_
  if(sum(counts)>0 && (max(counts)/sum(counts)>.85 || (is.finite(central_span)&&central_span>0&&central_span/diff(range)<.05))) warnings <- c(warnings,"イベントが狭い範囲に集中しています。表示範囲や変換幅を見直してください。")
  if(identical(req$axis$scale,"log") && nonpositive>0) warnings <- c(warnings,"Logでは0以下の値が左端に表示されます。負値を比較する場合はBiexponentialを推奨します。")
  list(range=as.list(range), counts=I(counts), ticks=axis_ticks(req$axis, range),warnings=as.list(warnings),
       total=length(values), outside=outside)
}
# v0.4 rendering -----------------------------------------------------------
superscript_digits <- c("⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹")
superscript_integer <- function(value) {
  digits <- strsplit(as.character(abs(as.integer(value))), "", fixed = TRUE)[[1]]
  paste0(if (value < 0) "⁻" else "", superscript_digits[as.integer(digits) + 1L], collapse = "")
}
axis_tick_label <- function(value) {
  if (!is.finite(value)) return("")
  magnitude <- abs(value)
  sign <- if (value < 0) "−" else ""
  if (magnitude >= 1000 || (magnitude > 0 && magnitude < .01)) {
    exponent <- floor(log10(magnitude))
    mantissa <- signif(magnitude / 10^exponent, 2)
    if (mantissa >= 10) { exponent <- exponent + 1L; mantissa <- 1 }
    coefficient <- if (abs(mantissa - 1) < 1e-10) "" else
      paste0(format(mantissa, scientific = FALSE, trim = TRUE), "×")
    return(paste0(sign, coefficient, "10", superscript_integer(exponent)))
  }
  format(round(value, if (magnitude < 10) 2 else 0), big.mark = ",",
         trim = TRUE, scientific = FALSE)
}
axis_ticks <- function(axis, display_range) {
  scale <- axis$scale %||% "linear"
  if (identical(scale, "log")) {
    low <- max(-300,floor(display_range[1])); high <- min(300,ceiling(display_range[2]))
    decades <- if(low<=high)seq(low,high) else numeric()
    raw <- as.vector(outer(10^decades, 1:9, `*`))
    at <- log10(raw)
    major <- rep(1:9 == 1, each=length(decades))
  } else if (identical(scale, "logicle")) {
    tr <- logicleTransform(w=axis$w %||% .5,t=axis$t %||% 262144,m=axis$m %||% 4.5,a=axis$a %||% 0)
    top <- max(1,axis$t %||% 262144); decades <- 0:ceiling(log10(top))
    positive <- as.vector(outer(10^decades,1:9,`*`))
    raw <- c(-positive,0,positive)
    major <- c(rep(1:9 == 1,each=length(decades)),TRUE,rep(1:9 == 1,each=length(decades)))
    at <- tr(raw)
  } else { at <- pretty(display_range,n=6); raw <- at; major <- rep(TRUE,length(at)) }
  keep <- is.finite(at) & at >= display_range[1] & at <= display_range[2]
  raw <- raw[keep]; at <- at[keep]; major <- major[keep]
  label <- if(identical(scale,"linear"))
    vapply(raw,function(v) format(signif(v,4),big.mark=",",trim=TRUE,scientific=FALSE),"")
    else ifelse(major,vapply(raw,axis_tick_label,""),"")
  lapply(seq_along(at),function(i) list(value=unname(at[i]),label=label[i],major=major[i]))
}

smooth_grid <- function(z) {
  nr<-nrow(z);nc<-ncol(z);out<-matrix(0,nr,nc);k<-c(1,2,1)
  for(i in -1:1) for(j in -1:1) out<-out+z[pmax(1,pmin(nr,seq_len(nr)+i)),pmax(1,pmin(nc,seq_len(nc)+j)),drop=FALSE]*k[i+2]*k[j+2]/16
  out
}

density_grid <- function(x,y,xr,yr,bins=128L,smoothing=TRUE,contour_percent=10) {
  bins <- max(16L,min(256L,as.integer(bins %||% 128L)))
  ok <- is.finite(x)&is.finite(y)&x>=xr[1]&x<=xr[2]&y>=yr[1]&y<=yr[2]
  x <- x[ok]; y <- y[ok]
  xi <- pmin(bins,pmax(1L,floor((x-xr[1])/diff(xr)*bins)+1L))
  yi <- pmin(bins,pmax(1L,floor((y-yr[1])/diff(yr)*bins)+1L))
  z <- matrix(tabulate(xi+(yi-1L)*bins,nbins=bins*bins),bins,bins)
  if(isTRUE(smoothing) && length(x)) { z <- smooth_grid(smooth_grid(z)); total_z <- sum(z); if(total_z>0) z <- z*length(x)/total_z }
  centers_x <- seq(xr[1]+diff(xr)/(2*bins),xr[2]-diff(xr)/(2*bins),length.out=bins)
  centers_y <- seq(yr[1]+diff(yr)/(2*bins),yr[2]-diff(yr)/(2*bins),length.out=bins)
  requested <- as.numeric(unlist(contour_percent %||% 10))
  if(any(!is.finite(requested)) || any(requested<=0) || any(requested>=100))fail("Invalid contour probability")
  if(length(requested)==1) requested <- seq(requested,99,by=requested)
  fractions <- sort(unique(pmin(99,pmax(1,requested)))/100)
  positive <- sort(as.vector(z[z>0]),decreasing=TRUE); levels <- numeric()
  if(length(positive)) for(f in fractions) levels <- c(levels,positive[which(cumsum(positive)>=f*sum(positive))[1]])
  levels <- sort(unique(levels)); masses <- if(sum(z)>0) vapply(levels,function(l) sum(z[z>=l])/sum(z),0) else numeric()
  cls <- if(length(levels)) grDevices::contourLines(centers_x,centers_y,z,levels=levels) else list()
  contours <- lapply(cls,function(cl) list(level=cl$level,x=I(cl$x),y=I(cl$y)))
  list(x=I(centers_x),y=I(centers_y),z=I(as.vector(z)),levels=I(levels),massFractions=I(masses),contours=contours,.matrix=z,.ok=ok,.xi=xi,.yi=yi)
}

worksheet_plot <- function(entry, card, s) {
  started <- proc.time()[["elapsed"]]
  on.exit({
    .cache_metrics$plotBuilds <- .cache_metrics$plotBuilds + 1L
    .cache_metrics$plotSeconds <- .cache_metrics$plotSeconds + proc.time()[["elapsed"]] - started
  }, add = TRUE)
  gate_id <- resolve_population(entry$gates,card$population); pool <- which(entry$masks[[gate_id]])
  mode <- card$mode %||% "scatter"
  x <- cached_axis(entry,card$x); y <- if(mode %in% c("histogram","cdf"))rep(0,length(x))else cached_axis(entry,card$y)
  xr <- display_limits(x[pool],card$x); yr <- if(mode %in% c("histogram","cdf"))c(0,1)else display_limits(y[pool],card$y)
  auto_range <- function(values, axis, shown_range) {
    if(!isTRUE(axis$autoRange)) return(shown_range)
    display_limits(values[pool],list())
  }
  auto_xr <- auto_range(x,card$x,xr)
  auto_yr <- if(mode %in% c("histogram","cdf")) yr else auto_range(y,card$y,yr)
  if(!mode %in% c("scatter","histogram","cdf","density","contour","pseudocolor","zebra"))fail("Unknown plot mode")
  if(!is.null(card$bins) && (length(card$bins)!=1 || !is.finite(card$bins) || card$bins<16 || card$bins>512))fail("Bins must be between 16 and 512")
  if(!is.null(card$dotSize) && (!is.finite(card$dotSize)||card$dotSize<.5||card$dotSize>8))fail("Dot size must be between 0.5 and 8")
  if(!is.null(card$dotOpacity) && (!is.finite(card$dotOpacity)||card$dotOpacity<.05||card$dotOpacity>1))fail("Dot opacity must be between 0.05 and 1")
  render_x <- x; render_y <- y
  if(identical(card$x$scale,"log"))render_x[!is.finite(render_x)] <- xr[1]
  if(identical(card$y$scale,"log"))render_y[!is.finite(render_y)] <- yr[1]
  finite_axes <- if(mode %in% c("histogram","cdf")) is.finite(x[pool]) else is.finite(render_x[pool])&is.finite(render_y[pool])
  excluded <- sum(!finite_axes)
  in_view <- finite_axes & x[pool]>=xr[1] & x[pool]<=xr[2]
  if(!mode %in% c("histogram","cdf")) in_view <- in_view & y[pool]>=yr[1] & y[pool]<=yr[2]
  visible <- pool[finite_axes]; shown_count <- length(visible)
  max_points <- 12000L; index <- if(length(visible)>max_points) visible[unique(round(seq(1,length(visible),length.out=max_points)))] else visible
  histogram <- NULL; cdf <- NULL; density <- NULL; point_density <- numeric()
  if(mode=="histogram") {
    values <- x[pool]; values <- values[is.finite(values)&values>=xr[1]&values<=xr[2]]
    breaks <- seq(xr[1],xr[2],length.out=(as.integer(card$bins %||% 128L)+1L)); h <- hist(values,breaks=breaks,plot=FALSE,include.lowest=TRUE)
    norm <- card$histogramNormalize %||% "count"; counts <- h$counts
    if(norm=="percent") counts <- if(sum(counts)) 100*counts/sum(counts) else counts
    if(norm=="mode") counts <- if(max(counts)) 100*counts/max(counts) else counts
    histogram <- list(edges=I(h$breaks),counts=I(counts),rawCounts=I(h$counts),normalize=norm)
    yr <- c(0,max(1,counts)*1.08); shown_count <- length(values); index <- integer()
  } else if(mode=="cdf") {
    values <- sort(x[pool]); values <- values[is.finite(values)&values>=xr[1]&values<=xr[2]]
    cdf <- list(x=I(values),y=I(if(length(values)) 100*seq_along(values)/length(values) else numeric()),condition="selected events with finite x inside xRange")
    yr <- c(0,100); shown_count <- length(values); index <- integer()
  } else if(mode %in% c("density","contour","pseudocolor","zebra")) {
    dg <- density_grid(pmax(xr[1],pmin(xr[2],render_x[pool])),pmax(yr[1],pmin(yr[2],render_y[pool])),xr,yr,card$bins %||% 128L,card$smoothing %||% TRUE,card$contourPercent %||% 10)
    density <- dg[c("x","y","z","levels","massFractions","contours")]
    if(length(index)) {
      xi <- pmin(length(dg$x),pmax(1L,floor((render_x[index]-xr[1])/diff(xr)*length(dg$x))+1L)); yi <- pmin(length(dg$y),pmax(1L,floor((render_y[index]-yr[1])/diff(yr)*length(dg$y))+1L))
      point_density <- dg$.matrix[cbind(xi,yi)]
    }
  }
  axis_eligible <- function(g) {
    sample_ok <- identical(g$sampleId,s$id)||identical(g$scope,"global")
    if(!sample_ok || !identical(g$x$channel,card$x$channel))return(FALSE)
    if(mode %in% c("histogram","cdf"))return(identical(g$type,"range"))
    !identical(g$type,"range") && identical(g$y$channel,card$y$channel)
  }
  eligible_gates <- Filter(axis_eligible,entry$gates)
  eligible_ids <- vapply(eligible_gates,function(g)g$id,"")
  is_descendant <- function(g) {
    current <- g
    repeat {
      parent_id <- current$parent
      if(identical(parent_id,gate_id))return(TRUE)
      if(is.null(parent_id)||identical(parent_id,"root"))return(identical(gate_id,"root"))
      parent <- Filter(function(candidate)identical(candidate$id,parent_id),entry$gates)
      if(!length(parent))return(FALSE)
      current <- parent[[1]]
    }
  }
  display_ids <- if(is.null(card$displayGates))
    vapply(Filter(is_descendant,eligible_gates),function(g)g$id,"") else
      intersect(as.character(unlist(card$displayGates)),eligible_ids)
  color_gates <- Filter(is_descendant,entry$gates)
  gate_depth <- function(g) {
    depth <- 1L
    parent_id <- g$parent
    while(!is.null(parent_id)&&!identical(parent_id,"root")) {
      parent <- Filter(function(candidate)identical(candidate$id,parent_id),entry$gates)
      if(!length(parent))break
      depth <- depth+1L
      parent_id <- parent[[1]]$parent
    }
    depth
  }
  population_gate <- if(identical(gate_id,"root")) NULL else {
    matches <- Filter(function(g)identical(g$id,gate_id),entry$gates)
    if(length(matches)) matches[[1]] else NULL
  }
  base_color <- population_gate$color %||% card$color %||% "#146b8c"
  point_colors <- rep(base_color,length(index))
  deepest_depth <- rep(if(is.null(population_gate)) 0L else gate_depth(population_gate),length(index))
  if(length(color_gates) && mode=="scatter") for(gate in color_gates) {
    membership <- entry$masks[[gate$id]][index]
    depth <- gate_depth(gate)
    replace <- membership & depth >= deepest_depth
    point_colors[replace] <- gate$color %||% "#17699b"
    deepest_depth[replace] <- depth
  }
   list(id=card$id,x=card$x,y=card$y,mode=mode,sampleId=s$id,sampleName=s$name,gateId=gate_id,
        xRange=as.list(xr),yRange=as.list(yr),autoXRange=as.list(auto_xr),autoYRange=as.list(auto_yr),xTicks=axis_ticks(card$x,xr),yTicks=if(mode %in% c("histogram","cdf")) list() else axis_ticks(card$y,yr),
       points=list(),gateAxisMaps=gate_axis_maps(eligible_gates,card,xr,yr),xValues=I(if(length(index)) unname(render_x[index]) else numeric()),yValues=I(if(length(index)) unname(render_y[index]) else numeric()),pointDensity=I(point_density),pointColors=I(point_colors),displayGateIds=as.list(display_ids),
       histogram=histogram,cdf=cdf,density=density,shown=if(mode %in% c("density","contour","pseudocolor","zebra","histogram","cdf")) shown_count else length(index),total=length(pool),excluded=excluded,
       dotSize=card$dotSize %||% 1.6,dotOpacity=card$dotOpacity %||% .6,color=card$color %||% "#146b8c",smoothing=card$smoothing %||% TRUE,showOutliers=card$showOutliers %||% TRUE,
       contourPercent=card$contourPercent %||% 10,bins=card$bins %||% 128,histogramNormalize=card$histogramNormalize %||% "count",compensationEnabled=isTRUE(s$compensation$enabled),compensation=s$compensation)
}

gate_path <- function(id,gates) {
  names <- character(); while(!is.null(id) && id!="root") { g <- gates[[match(id,vapply(gates,function(x)x$id,""))]]; if(is.null(g)) break; names<-c(g$name,names); id<-g$parent }
  if(length(names)) paste(c("All events",names),collapse=" / ") else "All events"
}
csv_safe <- function(x,text=TRUE) {
  if(length(x)==0 || is.null(x) || is.na(x)) x <- "" else x <- as.character(x)
  if(text && grepl("^[=+@-]",x)) x <- paste0("'",x)
  paste0('"',gsub('"','""',x,fixed=TRUE),'"')
}
export_statistics_csv <- function(req) {
  if(!grepl("\\.csv$",req$path,ignore.case=TRUE)) fail("Statistics output must end in .csv")
  p<-check_project(req$project); if(!length(p$samples)) fail("No samples to export")
  wanted<-unlist(req$sampleIds %||% lapply(p$samples,function(s)s$id),use.names=FALSE); samples<-Filter(function(s)s$id %in% wanted,p$samples)
  if(!length(samples)) fail("No requested samples found")
  records<-list(); channels<-unique(unlist(lapply(samples,function(s)vapply(s$channels,function(ch)ch$id,""))))
  for(s in samples) { entry<-session_analysis(p,s,req$storage); gates<-entry$gates
    for(st in entry$stats) { row<-c(list(sampleId=s$id,sampleName=s$name,path=s$path %||% "",gateId=st$id,gatePath=gate_path(st$id,gates),parent=if(is.null(st$parent)) "" else gate_path(st$parent,gates),count=st$count,percentParent=st$percentParent %||% NA_real_,percentTotal=st$percentTotal %||% NA_real_,compensation=if(isTRUE(s$compensation$enabled)) "enabled" else "disabled"),setNames(lapply(channels,function(ch)st$medians[[ch]] %||% NA_real_),paste0("median:",channels))); records[[length(records)+1]]<-row }
  }
  headers<-names(records[[1]]); numeric_fields<-c("count","percentParent","percentTotal",grep("^median:",headers,value=TRUE))
  lines<-c(paste(vapply(headers,csv_safe,"",text=TRUE),collapse=","),vapply(records,function(r)paste(vapply(seq_along(headers),function(i)csv_safe(r[[i]],!headers[i]%in%numeric_fields),""),collapse=","),"")); tmp<-tempfile(tmpdir=dirname(req$path),fileext=".csv")
  con<-file(tmp,"wb"); writeBin(as.raw(c(0xef,0xbb,0xbf)),con); writeBin(charToRaw(enc2utf8(paste0(paste(lines,collapse="\r\n"),"\r\n"))),con); close(con); on.exit(if(file.exists(tmp))unlink(tmp),add=TRUE)
  if(!file.rename(tmp,req$path)) { if(!file.copy(tmp,req$path,overwrite=TRUE)) fail("Cannot write statistics CSV"); unlink(tmp) }; list(path=normalizePath(req$path,winslash="/"),rows=length(records))
}

spaced_ticks <- function(ticks,range,side=1,cex=.72) {
  if(!length(ticks))return(ticks)
  values<-vapply(ticks,function(t)t$value,0)
  valid<-which(values>=range[1]&values<=range[2]&vapply(ticks,function(t)nzchar(t$label),FALSE))
  if(!length(valid))return(list())
  valid<-valid[order(values[valid])]
  available<-par("pin")[[side]]
  centers<-(values[valid]-range[1])/diff(range)*available
  labels<-vapply(ticks[valid],function(t)t$label,"")
  sizes<-if(side==1)strwidth(labels,cex=cex,units="inches") else strheight(labels,cex=cex,units="inches")
  chosen<-integer()
  for(i in seq_along(valid)) {
    if(!length(chosen)||centers[i]-centers[tail(chosen,1)] >= (sizes[i]+sizes[tail(chosen,1)])/2+.09)
      chosen<-c(chosen,i)
  }
  ticks[valid[chosen]]
}
draw_ticks <- function(d,mode,show_x=TRUE,compact=FALSE) {
  cex<-if(compact).58 else .68
  xt<-spaced_ticks(d$xTicks,unlist(d$xRange),1,cex)
  yt<-spaced_ticks(d$yTicks,unlist(d$yRange),2,cex)
  if(show_x) {
    minor<-Filter(function(t)!nzchar(t$label),d$xTicks)
    if(length(minor))axis(1,at=vapply(minor,function(t)t$value,0),labels=FALSE,tcl=-.2)
    axis(1,at=vapply(xt,function(t)t$value,0),labels=vapply(xt,function(t)t$label,""),las=1,cex.axis=cex)
  }
  minor_y<-Filter(function(t)!nzchar(t$label),d$yTicks)
  if(length(minor_y))axis(2,at=vapply(minor_y,function(t)t$value,0),labels=FALSE,tcl=-.2)
  if(!mode %in% c("histogram","cdf")) axis(2,at=vapply(yt,function(t)t$value,0),labels=vapply(yt,function(t)t$label,""),las=1,cex.axis=cex) else axis(2,las=1,cex.axis=cex)
}
heat_colors <- function(values, points=FALSE) {
  good<-sort(values[is.finite(values)]);if(!length(good))return(rep("white",length(values)))
  lo<-good[floor((length(good)-1)*.03)+1];hi<-good[floor((length(good)-1)*.98)+1]
  q<-pmax(0,pmin(1,(values-lo)/if(hi>lo)hi-lo else 1))
  ramp<-colorRamp(c(if(points)"#345b9e" else "#f6f8fa","#2f86a7","#209e70","#f4be30","#c4302b"))
  rgb(ramp(q),maxColorValue=255)
}
print_channel_label <- function(sample, channel) {
  entries <- sample$channels %||% list()
  match <- Filter(function(item) identical(item$id, channel), entries)
  if (!length(match)) return(channel)
  label <- as.character(match[[1]]$label %||% channel)
  if (!nzchar(label) || identical(label, channel)) channel else label
}

draw_card <- function(card,d,compact=FALSE,sample_info=NULL) {
  mode<-d$mode;hist_label<-switch(d$histogramNormalize,count="Count",percent="% of events",mode="% of maximum","Count")
  plot(NA,xlim=unlist(d$xRange),ylim=unlist(d$yRange),axes=FALSE,xaxs="i",yaxs="i",xlab="",ylab="",main=NULL)
  col<-d$color;alpha<-d$dotOpacity;den<-d$density;pd<-unlist(d$pointDensity)
  xs<-unlist(d$xValues);ys<-unlist(d$yValues)
  if(mode %in% c("scatter","pseudocolor","density","contour","zebra")) {
    xs<-pmax(unlist(d$xRange)[1],pmin(unlist(d$xRange)[2],xs))
    ys<-pmax(unlist(d$yRange)[1],pmin(unlist(d$yRange)[2],ys))
  }
  if(mode=="histogram") {e<-unlist(d$histogram$edges);v<-unlist(d$histogram$counts);polygon(c(e[1],rep(e,each=2)[-c(1,2*length(e))],tail(e,1)),c(0,rep(v,each=2),0),col=col,border=NA)}
  else if(mode=="cdf") {if(length(d$cdf$x))lines(unlist(d$cdf$x),unlist(d$cdf$y),type="s",col=col,lwd=1.3)}
  else if(mode %in% c("density","zebra")) {
    nx<-length(den$x);ny<-length(den$y);z<-unlist(den$z);dx<-diff(unlist(d$xRange))/nx;dy<-diff(unlist(d$yRange))/ny
    keep<-which(z>0);cols<-if(mode=="density")heat_colors(z) else ifelse(findInterval(z,unlist(den$levels))%%2,"#dcecf0","#f7fafb")
    if(length(keep)){xx<-rep(unlist(den$x),ny);yy<-rep(unlist(den$y),each=nx);rect(xx[keep]-dx/2,yy[keep]-dy/2,xx[keep]+dx/2,yy[keep]+dy/2,col=cols[keep],border=NA)}
  } else if(mode=="pseudocolor") {if(length(xs))points(xs,ys,pch=16,cex=d$dotSize/5,col=adjustcolor(heat_colors(pd,TRUE),alpha.f=alpha+(1-alpha)*.45))}
  else if(mode=="scatter" && length(xs)) {
    point_colors<-unlist(d$pointColors %||% character(),use.names=FALSE)
    if(length(point_colors)!=length(xs))point_colors<-rep("",length(xs))
    point_colors[!nzchar(point_colors)]<-col
    points(xs,ys,pch=16,cex=d$dotSize/5,col=adjustcolor(point_colors,alpha.f=alpha))
  }
  if(mode %in% c("contour","zebra"))for(line in den$contours)lines(unlist(line$x),unlist(line$y),col=col,lwd=.8)
  if(mode %in% c("contour","density","zebra") && isTRUE(d$showOutliers) && length(den$levels) && length(xs)) {
    keep<-is.finite(pd)&pd<min(unlist(den$levels));if(any(keep))points(xs[keep],ys[keep],pch=16,cex=d$dotSize/5,col=adjustcolor(col,alpha.f=alpha))
  }
  draw_ticks(d,mode,!isFALSE(card$showXAxis),compact)
  if(!isFALSE(card$showXAxis))mtext(print_channel_label(sample_info,card$x$channel),side=1,line=if(compact)2.1 else 2.6,cex=if(compact).56 else .68)
  mtext(if(mode=="histogram")hist_label else if(mode=="cdf")"Cumulative %" else print_channel_label(sample_info,card$y$channel),side=2,line=if(compact)2.35 else 2.9,cex=if(compact).56 else .68)
  if(!isFALSE(card$showXAxis))box(bty="l") else segments(unlist(d$xRange)[1],unlist(d$yRange)[1],unlist(d$xRange)[1],unlist(d$yRange)[2])
  if(compact) {
    mtext(substr(paste(d$sampleName,if(!isFALSE(card$showGateNames))paste(unlist(card$population),collapse=" / ")else""),1,48),side=3,line=.5,cex=.55,font=2)
  } else {
    mtext(substr(d$sampleName,1,45),side=3,line=2.3,cex=.8,font=2)
    if(!isFALSE(card$showGateNames))mtext(substr(paste(c("All events",unlist(card$population)),collapse=" / "),1,55),side=3,line=1.2,cex=.7)
    mtext(sprintf("N = %s%s",format(d$total,big.mark=","),if(d$excluded)sprintf(" | %s outside transform",format(d$excluded,big.mark=","))else""),side=3,line=.15,cex=.6)
  }
}

draw_child_gates <- function(card,d,project,statistics=list()) {
  show_name <- !isFALSE(card$showGateNames)
  show_pct <- !isFALSE(card$showGatePercentages)
  gate_label <- function(g) { row<-Filter(function(x) identical(x$id,g$id),statistics); pct<-if(length(row)) row[[1]]$percentParent else NULL; paste0(if(show_name) g$name else "",if(show_pct && !is.null(pct)) paste0(if(show_name) " · " else "",sprintf("%.1f%%",pct)) else "") }
  gate_col <- function(g) g$color %||% "#303e48"
  font_size <- suppressWarnings(as.numeric(card$gateLabelFontSizePt %||% 8.25))
  if(length(font_size)!=1L || !is.finite(font_size)) font_size <- 8.25
  label_cex <- max(6,min(24,font_size))/12
  xr <- unlist(d$xRange); yr <- unlist(d$yRange)
  draw_label <- function(g,x,y,anchor=0) {
    value <- gate_label(g)
    if(!nzchar(value)) return(invisible(NULL))
    position <- card$gateLabelPositions[[g$id]]
    if(!is.null(position) && is.numeric(position$x) && is.numeric(position$y) &&
       length(position$x)==1L && length(position$y)==1L && is.finite(position$x) && is.finite(position$y)) {
      x <- xr[1]+max(0,min(1,position$x))*diff(xr)
      y <- yr[2]-max(0,min(1,position$y))*diff(yr)
    }
    label_width <- min(diff(xr),strwidth(value,cex=label_cex))
    label_height <- min(diff(yr),strheight(value,cex=label_cex))
    x <- max(xr[1]+anchor*label_width,min(xr[2]-(1-anchor)*label_width,x))
    y <- max(yr[1],min(yr[2]-label_height,y))
    text(x,y,value,adj=c(anchor,0),cex=label_cex,col=gate_col(g))
  }
  same_axis <- function(a,b) identical(a[c("channel","scale","w","t","m","a")],b[c("channel","scale","w","t","m","a")])
  shown_ids <- unlist(d$displayGateIds %||% list(),use.names=FALSE)
  seen_groups <- character()
  for(g in Filter(function(g) g$id %in% shown_ids&&(identical(g$sampleId,d$sampleId)||identical(g$scope,"global")),project$gates %||% list())) {
    if(!identical(g$x$channel,card$x$channel) || (g$type!="range" && !identical(g$y$channel,card$y$channel))) next
    g <- project_gate_geometry(g,card,d)
    if(g$type=="range") {
      if(d$mode %in% c("histogram","cdf")) {
        b<-unlist(g$bounds); if(b[2]<xr[1]||b[1]>xr[2]) next
        b<-pmax(xr[1],pmin(xr[2],b)); y<-yr[2]-.12*diff(yr)
        lines(c(b[1],b[1],b[2],b[2]),c(y-.02*diff(yr),y,y,y-.02*diff(yr)),col=gate_col(g),lwd=1.1)
        draw_label(g,b[1]+.02*diff(xr),y+.02*diff(yr))
      }
      next
    }
    if(d$mode %in% c("histogram","cdf") || !same_axis(g$y,card$y)) next
    if(g$type=="rectangle") {
      b<-unlist(g$bounds); rect(b[1],b[3],b[2],b[4],border=gate_col(g),lwd=1.1)
      draw_label(g,b[1]+.02*diff(xr),b[4]+.02*diff(yr))
    }
    if(g$type=="polygon") {
      v<-matrix_from(g$vertices); polygon(v,border=gate_col(g),lwd=1.1)
      draw_label(g,v[1,1]+.02*diff(xr),v[1,2]+.02*diff(yr))
    }
    if(g$type=="quadrant") {
      group <- g$groupId %||% g$id
      if(!group %in% seen_groups) {
        abline(v=g$center[[1]],h=g$center[[2]],col=gate_col(g),lwd=1.1)
        seen_groups <- c(seen_groups,group)
      }
      right <- g$quadrant %in% c(2,4); upper <- g$quadrant %in% c(1,2)
      draw_label(g,if(right)xr[2]-.02*diff(xr) else xr[1]+.02*diff(xr),
        if(upper)yr[2]-.06*diff(yr) else yr[1]+.02*diff(yr),if(right)1 else 0)
    }
    if(g$type=="ellipse") {
      b<-unlist(g$bounds); th<-seq(0,2*pi,length.out=181)
      if(length(g$vertices)) polygon(matrix_from(g$vertices),border=gate_col(g),lwd=1.1)
      else lines(mean(b[1:2])+diff(b[1:2])/2*cos(th),mean(b[3:4])+diff(b[3:4])/2*sin(th),col=gate_col(g),lwd=1.1)
      draw_label(g,b[1]+.02*diff(xr),b[4]+.02*diff(yr))
    }
  }
}

draw_missing_population <- function(card) {
  plot.new(); plot.window(xlim=c(0,1),ylim=c(0,1),xaxs="i",yaxs="i")
  rect(.03,.04,.97,.96,border="#b75a35",lwd=1.4)
  title(main=fit_pdf_text(paste(card$x$channel %||% "X", "×", card$y$channel %||% "Y"),.9,.82))
  text(.5,.57,"分画なし",col="#a4402a",font=2,cex=1.05)
  text(.5,.44,fit_pdf_text(paste(unlist(card$population %||% list()),collapse=" / "),.82,.72),cex=.72)
}

statistics_population_key <- function(id, gates) {
  path <- character()
  while(!is.null(id) && id != "root") {
    gate <- gates[[match(id,vapply(gates,function(item)item$id,""))]]
    if(is.null(gate)) break
    path <- c(gate$name,path)
    id <- gate$parent
  }
  as.character(jsonlite::toJSON(path,auto_unbox=FALSE))
}
visible_widget_statistics <- function(widget, statistics, gates=list()) {
  hidden <- unlist(widget$hiddenPopulationPaths %||% list(),use.names=FALSE)
  if(!length(hidden)) return(statistics)
  Filter(function(row) !statistics_population_key(row$id,gates) %in% hidden,statistics)
}
statistics_gate_lineage <- function(id, gates) {
  lineage <- list(); visited <- character()
  while(!is.null(id) && !identical(as.character(id),"root") && !as.character(id) %in% visited) {
    gate <- gates[[match(as.character(id),vapply(gates,function(item)as.character(item$id),""))]]
    if(is.null(gate)) break
    lineage <- c(list(gate),lineage)
    visited <- c(visited,as.character(id))
    id <- gate$parent
  }
  lineage
}
statistics_tree_prefix <- function(index, lineages) {
  lineage <- lineages[[index]]
  if(!length(lineage)) return("")
  ids <- vapply(lineage,function(gate)as.character(gate$id),"")
  has_later_sibling <- rep(FALSE,length(ids))
  if(index < length(lineages)) for(level in seq_along(ids)) {
    for(next_index in seq.int(index+1,length(lineages))) {
      next_ids <- vapply(lineages[[next_index]],function(gate)as.character(gate$id),"")
      prefix_matches <- level == 1L || identical(next_ids[seq_len(level-1L)],ids[seq_len(level-1L)])
      if(length(next_ids) >= level && prefix_matches && next_ids[[level]] != ids[[level]]) {
        has_later_sibling[[level]] <- TRUE
        break
      }
    }
  }
  pieces <- vapply(seq_along(ids),function(level) {
    if(level < length(ids)) if(has_later_sibling[[level]]) "│  " else "   "
    else if(has_later_sibling[[level]]) "├─ " else "└─ "
  },"")
  paste0(pieces,collapse="")
}
fit_pdf_text <- function(value,width,cex=.7) {
  value<-as.character(value %||% "")
  if(!nzchar(value)||strwidth(value,cex=cex)<=width)return(value)
  chars<-nchar(value,type="chars")
  while(chars>1 && strwidth(paste0(substr(value,1,chars),"…"),cex=cex)>width)
    chars<-chars-1L
  paste0(substr(value,1,chars),"…")
}
draw_statistics_widget <- function(widget, statistics, sample_info, gates=list()) {
  statistics <- visible_widget_statistics(widget,statistics,gates)
  sample_name <- sample_info$name %||% "Selected sample"
  show_events <- !identical(widget$showEvents,FALSE)
  show_parent <- !identical(widget$showPercentParent,FALSE)
  show_total <- !identical(widget$showPercentTotal,FALSE)
  font_size_pt <- suppressWarnings(as.numeric(widget$fontSizePt %||% 9))
  if(length(font_size_pt)!=1L || !is.finite(font_size_pt)) font_size_pt <- 9
  font_size_pt <- max(6,min(18,font_size_pt))
  requested_cex <- font_size_pt/12
  mfi_channels <- unlist(widget$mfiChannels %||% list(),use.names=FALSE)
  columns <- c(if(show_events) "Events",if(show_parent) "% Parent",if(show_total) "% Total",
    if(length(mfi_channels))paste("MFI",vapply(mfi_channels,function(channel)print_channel_label(sample_info,channel),""),sep=" · "))
  values_for <- function(row) {
    values <- c(if(show_events) format(row$count,big.mark=",",scientific=FALSE),
      if(show_parent) if(is.null(row$percentParent)) "NA" else sprintf("%.2f",row$percentParent),
      if(show_total) if(is.null(row$percentTotal)) "NA" else sprintf("%.2f",row$percentTotal))
    if(length(mfi_channels)) values <- c(values,vapply(mfi_channels,function(channel) {
      value <- row$medians[[channel]]
      if(is.null(value)||!is.finite(value)) "NA" else format(signif(value,4),scientific=FALSE,trim=TRUE)
    },""))
    values
  }
  lineages <- lapply(statistics,function(row) {
    if(identical(as.character(row$id),"root")) list() else statistics_gate_lineage(row$id,gates)
  })
  plot.new();plot.window(xlim=c(0,1),ylim=c(0,1),xaxs="i",yaxs="i")
  title(main=fit_pdf_text(paste("Population statistics |",sample_name),.95,min(1.25,requested_cex)),cex.main=min(1.25,requested_cex))
  count<-length(columns)
  name_end<-if(count) max(.29,min(.53,.66-.047*count)) else .98
  cell_width<-if(count)(.98-name_end)/count else 0
  right<-if(count) name_end+seq_len(count)*cell_width else numeric()
  header_cex<-min(requested_cex,max(.43,min(.82,.86-.035*count)))
  text(.02,.91,"Population",adj=0,font=2,cex=header_cex)
  if(count) for(j in seq_len(count))
    text(right[j],.91,fit_pdf_text(columns[j],cell_width-.014,header_cex),adj=1,font=2,cex=header_cex)
  segments(.02,.865,.98,.865,col="#ccd8df",lwd=.6)
  if(length(statistics)) {
    step<-.78/max(length(statistics),4)
    line_height<-strheight("Ag",cex=1,units="user")
    fit_cex<-if(is.finite(line_height)&&line_height>0) .84*step/line_height else requested_cex
    cex<-min(requested_cex,fit_cex)
    for(i in seq_along(statistics)) {
      row<-statistics[[i]]
      y<-.84-(i-1)*step
      prefix<-statistics_tree_prefix(i,lineages)
      name_width<-max(.04,name_end-.04-strwidth(prefix,cex=cex))
      text(.02,y,paste0(prefix,fit_pdf_text(row$name,name_width,cex)),adj=0,cex=cex)
      vals<-values_for(row)
      if(length(vals)) for(j in seq_along(vals))
        text(right[j],y,fit_pdf_text(vals[j],cell_width-.014,cex),adj=1,cex=cex)
    }
  }
}

draw_compensation_widget <- function(widget, project, fallback_sample_id) {
  sample_id <- widget$reportSampleId %||% widget$sampleId %||% fallback_sample_id
  if(is.null(sample_id) || identical(sample_id,"active")) sample_id <- fallback_sample_id
  matches <- Filter(function(s)identical(s$id,sample_id),project$samples)
  if(!length(matches)) {
    plot.new(); text(.5,.5,"Compensation sample unavailable"); return(invisible())
  }
  sample <- matches[[1]]; config <- sample$compensation
  if(identical(widget$draftSampleId,sample$id) && !is.null(widget$displayCompensation))
    config <- widget$displayCompensation
  channels <- unlist(config$channels %||% list(),use.names=FALSE)
  visible <- if(is.null(widget$visibleChannels)) channels else unlist(widget$visibleChannels,use.names=FALSE)
  indices <- which(channels %in% visible)
  values <- matrix_from(config$values)
  plot.new(); plot.window(xlim=c(0,1),ylim=c(0,1),xaxs="i",yaxs="i")
  title(main=fit_pdf_text(paste("Compensation |",sample$name),.96,.78))
  text(.04,.92,if(isTRUE(config$enabled))"APPLIED"else"NOT APPLIED",adj=0,cex=.66,font=2)
  if(!length(indices)) {
    text(.5,.52,"表示する蛍光がありません",cex=.76)
    return(invisible())
  }
  row_y <- seq(.78,.18,length.out=length(indices))
  col_x <- seq(.40,.96,length.out=length(indices))
  label_cex <- max(.38,min(.7,.72-.012*length(indices)))
  labels <- vapply(channels,function(channel)print_channel_label(sample,channel),"")
  text(.03,row_y,labels[indices],adj=0,cex=label_cex)
  text(col_x,rep(.86,length(indices)),labels[indices],srt=45,adj=1,cex=label_cex)
  for(i in seq_along(indices)) for(j in seq_along(indices)) {
    x <- col_x[j]; y <- row_y[i]
    rect(x-.035,y-.025,x+.035,y+.025,border="#d5dee5",col=if(i==j)"#edf2f6"else"white")
    text(x,y,formatC(values[indices[i],indices[j]]*100,format="f",digits=2),cex=.58)
  }
}

# A worksheet PDF uses the same A4 rectangles shown on the canvas. Cairo's
# device size is fixed for a document, so pages are rendered separately and
# merged by the bundled Rust host when both orientations are present.
export_print_pages <- function(req,data,cards,widgets) {
  pages <- req$printPages %||% list(list(left=0,top=0,orientation="landscape"))
  if(!length(pages)) pages <- list(list(left=0,top=0,orientation="landscape"))
  plot_elements <- lapply(cards,function(value)list(kind="plot",value=value))
  active_plot <- Filter(function(item)identical(item$value$id,req$activePlotId %||% ""),plot_elements)
  plot_elements <- Filter(function(item)!identical(item$value$id,req$activePlotId %||% ""),plot_elements)
  widget_elements <- lapply(widgets,function(value)list(kind=if(identical(value$type,"compensation"))"compensation"else"statistics",value=value))
  # The active card is raised above other plots and widgets in the worksheet.
  elements <- c(plot_elements,widget_elements,active_plot)
  width_of <- function(item) item$value$width %||% if(item$kind %in% c("statistics","compensation"))640 else 344
  height_of <- function(item) item$value$height %||% if(identical(item$kind,"compensation"))360 else if(identical(item$kind,"statistics"))340 else 314
  files <- character(); success <- FALSE; printed <- character(); page_count <- 0L
  on.exit(if(!success && length(files))unlink(files),add=TRUE)
  report <- isTRUE(req$reportBySample)
  sample_groups <- if(report) lapply(req$project$samples,function(s)
    Filter(function(item)identical(item$value$reportSampleId,s$id),elements)) else list(elements)
  if(report && !length(sample_groups)) fail("No samples are available for the report")
  for(sample_index in seq_along(sample_groups)) for(page in pages) {
    page_elements <- sample_groups[[sample_index]]
    portrait <- identical(page$orientation,"portrait")
    scale <- page$scale %||% 1
    width <- (if(portrait)794 else 1123)*scale
    height <- (if(portrait)1123 else 794)*scale
    safe_margin <- 16*scale
    left <- page$left %||% 0; top <- page$top %||% 0
    page_items <- Filter(function(item) {
      box <- item$value
      (box$left %||% 0) >= left+safe_margin && (box$top %||% 0) >= top+safe_margin &&
        (box$left %||% 0)+width_of(item) <= left+width-safe_margin &&
        (box$top %||% 0)+height_of(item) <= top+height-safe_margin
    },page_elements)
    # Preserve worksheet element order when painting overlapping items. Sorting
    # by position changes their stacking order relative to the canvas and can
    # cover most of an earlier plot when cards overlap.
    file <- tempfile(pattern="flowdesk-page-",tmpdir=dirname(req$path),fileext=".pdf")
    files <- c(files,file)
    page_count <- page_count + 1L
    grDevices::cairo_pdf(file,width=if(portrait)210/25.4 else 297/25.4,
      height=if(portrait)297/25.4 else 210/25.4,onefile=TRUE,
      family=if(.Platform$OS.type=="windows")"Yu Gothic" else "sans")
    tryCatch({
      if(!length(page_items)) {
        plot.new()
      } else for(i in seq_along(page_items)) {
        item <- page_items[[i]]; value <- item$value
        x1 <- (value$left-left)/width; x2 <- (value$left+width_of(item)-left)/width
        y1 <- (value$top-top)/height; y2 <- (value$top+height_of(item)-top)/height
        physical_width <- width_of(item)/width*(if(portrait)210/25.4 else 297/25.4)
        compact <- physical_width < 3.7
        par(fig=c(x1,x2,1-y2,1-y1),new=i>1,
          mar=if(identical(item$kind,"statistics"))c(.7,.7,1.4,.45)
          else if(compact)c(2.8,3.3,1.9,.5) else c(3.2,3.8,2.5,.7))
        if(identical(item$kind,"plot")) {
          d <- data$plots[[value$id]]
          sid <- value$reportSampleId %||% value$sampleId
          if(is.null(sid)||identical(sid,"active"))sid <- req$sampleId
          matched_sample <- Filter(function(s)identical(s$id,sid),req$project$samples)
          report_sample <- if(length(matched_sample))matched_sample[[1]] else NULL
          if(isTRUE(value$reportPopulationMissing)) draw_missing_population(value) else {
            draw_card(value,d,compact,report_sample)
            draw_child_gates(value,d,req$project,data$stats[[d$sampleId]] %||% list())
          }
        } else if(identical(item$kind,"compensation")) {
          draw_compensation_widget(value,req$project,req$sampleId)
        } else {
          stats_id <- value$sampleId
          if(is.null(stats_id)||identical(stats_id,"active"))stats_id <- req$sampleId
          matched <- Filter(function(s)identical(s$id,stats_id),req$project$samples)
          sample_info <- if(length(matched))matched[[1]] else list(name="Selected sample",channels=list())
          draw_statistics_widget(value,data$stats[[stats_id]] %||% list(),sample_info,req$project$gates %||% list())
        }
        printed <- c(printed,value$id)
      }
    },finally=dev.off())
  }
  success <- TRUE
  missing <- Filter(function(card)isTRUE(card$reportPopulationMissing),cards)
  list(path=req$path,pageFiles=as.list(files),pages=page_count,
       plots=sum(vapply(cards,function(card)card$id %in% printed,FALSE)),
       outside=sum(!vapply(elements,function(item)item$value$id %in% printed,FALSE)),
       missingPopulations=as.list(lapply(missing,function(card)list(
         sample=card$reportSampleName %||% card$sampleId,
         population=paste(unlist(card$population %||% list()),collapse=" / ")))))
}

export_vector <- function(req,kind=c("pdf","svg"),single=FALSE) {
  kind<-match.arg(kind); ext<-paste0("\\.",kind,"$"); if(!grepl(ext,req$path,ignore.case=TRUE)) fail(paste(toupper(kind),"output has wrong extension"))
  include_plots <- !identical(req$includePlots, FALSE)
  include_widgets <- isTRUE(req$includeWidgets) && !single
  cards<-req$plots %||% list()
  print_cards<-cards
  analysis_req <- req
  analysis_req$plots <- Filter(function(card)!isTRUE(card$reportPopulationMissing),cards)
  data<-worksheet(analysis_req); if(length(data$errors)) fail(paste(unlist(data$errors),collapse="\n"))
  widgets<-if(include_widgets) req$widgets %||% list() else list()
  if(kind=="pdf" && !single)
    return(export_print_pages(req,data,if(include_plots)print_cards else list(),widgets))
  cards<-cards[order(vapply(cards,function(c)c$top %||% 0,0),vapply(cards,function(c)c$left %||% 0,0))]
  if(single) cards<-cards[1]
  if(include_plots && !length(cards) && !length(widgets)) fail("Worksheet is empty")
  if(!include_plots && kind!="pdf") fail("SVG output requires plots")
  tmp<-tempfile(tmpdir=dirname(req$path),fileext=paste0(".",kind)); closed<-FALSE
  page_w <- if(kind=="pdf" && !single) 11.69 else 7
  page_h <- if(kind=="pdf" && !single) 8.27 else 5.5
  if(kind=="pdf") grDevices::cairo_pdf(tmp,width=page_w,height=page_h,onefile=TRUE,family="Yu Gothic") else grDevices::svg(tmp,width=page_w,height=page_h,onefile=TRUE,family="Yu Gothic")
  on.exit({if(!closed)dev.off();if(file.exists(tmp))unlink(tmp)},add=TRUE)
  if(include_plots || length(widgets)) {
    # Each sample report page contains its own plots and statistics widget.
    groups <- if(isTRUE(req$reportBySample)) lapply(req$project$samples,function(s) list(
      cards=Filter(function(card)identical(card$reportSampleId,s$id),if(include_plots)cards else list()),
      widgets=Filter(function(widget)identical(widget$reportSampleId,s$id),widgets)
    )) else list(list(cards=if(include_plots)cards else list(),widgets=widgets))
    groups <- Filter(function(group)length(group$cards)>0 || length(group$widgets)>0,groups)
    for(group in groups) {
      elements <- c(lapply(group$cards,function(value)list(kind="plot",value=value)),lapply(group$widgets,function(value)list(kind=if(identical(value$type,"compensation"))"compensation"else"statistics",value=value)))
      elements <- elements[order(vapply(elements,function(item)item$value$top %||% 0,0),vapply(elements,function(item)item$value$left %||% 0,0))]
      lefts<-vapply(elements,function(item)item$value$left %||% 0,0)
      tops<-vapply(elements,function(item)item$value$top %||% 0,0)
      rights<-vapply(elements,function(item)(item$value$left %||% 0)+(item$value$width %||% if(item$kind %in% c("statistics","compensation"))640 else 344),0)
      bottoms<-vapply(elements,function(item)(item$value$top %||% 0)+(item$value$height %||% if(identical(item$kind,"compensation"))360 else if(identical(item$kind,"statistics"))340 else 314),0)
      min_left<-min(lefts);min_top<-min(tops)
      content_w<-max(rights)-min_left;content_h<-max(bottoms)-min_top
      scale<-min(page_w/(content_w+140),page_h/(content_h+110))
      offset_x<-(page_w-content_w*scale)/2
      offset_y<-(page_h-content_h*scale)/2
      for(i in seq_along(elements)) {
        item<-elements[[i]]; element<-item$value
        x1<-(offset_x+(lefts[i]-min_left)*scale)/page_w
        x2<-(offset_x+(rights[i]-min_left)*scale)/page_w
        y1<-(offset_y+(tops[i]-min_top)*scale)/page_h
        y2<-(offset_y+(bottoms[i]-min_top)*scale)/page_h
        compact <- min((rights[i]-lefts[i])*scale,(bottoms[i]-tops[i])*scale) < 2.6
        par(fig=c(x1,x2,1-y2,1-y1),new=i>1,mar=if(identical(item$kind,"statistics"))c(.7,.7,1.4,.45)else if(compact)c(2.8,3.3,1.9,.5)else c(3.2,3.8,2.5,.7))
        if(identical(item$kind,"plot")) {
          d<-data$plots[[element$id]]
          sid<-element$reportSampleId %||% element$sampleId
          if(is.null(sid)||identical(sid,"active"))sid<-req$sampleId
          matched_sample<-Filter(function(s)identical(s$id,sid),req$project$samples)
          report_sample<-if(length(matched_sample))matched_sample[[1]] else NULL
          draw_card(element,d,compact,report_sample)
          draw_child_gates(element,d,req$project,data$stats[[d$sampleId]] %||% list())
         } else if(identical(item$kind,"compensation")) {
           draw_compensation_widget(element,req$project,req$sampleId)
         } else {
          stats_id <- element$reportSampleId %||% element$sampleId
          if(is.null(stats_id)||identical(stats_id,"active")) stats_id<-req$sampleId
          sample_match<-Filter(function(s)identical(s$id,stats_id),req$project$samples)
          sample_info<-if(length(sample_match))sample_match[[1]] else list(name="Selected sample",channels=list())
          draw_statistics_widget(element,data$stats[[stats_id]] %||% list(),sample_info,req$project$gates %||% list())
        }
      }
    }
  }
  dev.off();closed<-TRUE; if(!file.rename(tmp,req$path)){if(!file.copy(tmp,req$path,overwrite=TRUE))fail(paste("Cannot write",kind));unlink(tmp)};list(path=normalizePath(req$path,winslash="/"),plots=if(include_plots)length(cards)else 0)
}

.dispatch_core <- dispatch
dispatch <- function(req) {
  if(identical(req$action,"axis_suggestion")) return(axis_suggestion(req))
  if(identical(req$action,"axis_preview")) return(axis_preview(req))
  if(identical(req$action,"statistics_csv")) return(export_statistics_csv(req))
  if(identical(req$action,"plot_pdf")) return(export_vector(req,"pdf",TRUE))
  if(identical(req$action,"plot_svg")) return(export_vector(req,"svg",TRUE))
  if(identical(req$action,"worksheet_pdf")) return(export_vector(req,"pdf",FALSE))
  if(identical(req$action,"worksheet_report_pdf")) {
    templates<-req$plots %||% list(); cards<-list(); widget_templates<-req$widgets %||% list(); widgets<-list()
    if(!length(req$project$samples))fail("No samples are available for the report")
    sample_ids<-vapply(req$project$samples,function(s)s$id,"")
    if(is.null(req$sampleId)||!req$sampleId%in%sample_ids)req$sampleId<-sample_ids[1]
    report_population_exists <- function(path,sample_id) {
      applicable<-Filter(function(g)gate_applies_to_sample(g,sample_id),req$project$gates %||% list())
      tryCatch({resolve_population(applicable,path %||% list());TRUE},error=function(e)FALSE)
    }
    for(s in req$project$samples) for(template in templates) {
      card<-template
      if(is.null(card$sampleId)||identical(card$sampleId,"active")) {
        card$id<-paste0(s$id,"/",card$id)
        card$sampleId<-s$id
        card$reportSampleId<-s$id
        card$reportSampleName<-s$name
        card$reportPopulationMissing<-!report_population_exists(card$population,s$id)
        cards[[length(cards)+1]]<-card
      }
    }
    for(template in templates) if(!is.null(template$sampleId)&&!identical(template$sampleId,"active")) {
      card<-template
      card$reportSampleId<-card$sampleId
      source <- Filter(function(s)identical(s$id,card$sampleId),req$project$samples)
      card$reportSampleName<-if(length(source))source[[1]]$name else card$sampleId
      card$reportPopulationMissing<-!report_population_exists(card$population,card$sampleId)
      cards[[length(cards)+1]]<-card
    }
    for(template in widget_templates) {
      target_id <- template$sampleId
      targets <- if(is.null(target_id)||identical(target_id,"active")) req$project$samples else
        Filter(function(s)identical(s$id,target_id),req$project$samples)
      for(s in targets) {
        widget<-template
        widget$id<-paste0(s$id,"/",widget$id)
        widget$sampleId<-s$id
        widget$reportSampleId<-s$id
        widgets[[length(widgets)+1]]<-widget
      }
    }
    req$plots<-cards
    req$widgets<-widgets
    req$includeWidgets<-TRUE
    req$reportBySample<-TRUE
    if(is.null(req$includePlots)) req$includePlots<-TRUE
    return(export_vector(req,"pdf",FALSE))
  }
  if(identical(req$action,"worksheet"))return(worksheet(req))
  if(identical(req$action,"health"))return(c(version_info(),list(workerPid=Sys.getpid(),cache=cache_health())))
  .dispatch_core(req)
}
