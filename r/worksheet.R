# Interactive worksheet engine. A bounded session cache retains at most two samples.
.sessions <- new.env(parent = emptyenv())
.session_order <- character()
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
    entry <- list(signature = sig, raw = read_frame(s, storage), config = NULL)
  }
  if (is.null(entry$frame) || !identical(entry$config, s$compensation)) {
    entry$frame <- apply_compensation(entry$raw, s$compensation)
    entry$config <- s$compensation
    entry$gates <- NULL; entry$masks <- NULL; entry$stats <- NULL
    entry$axes <- new.env(parent = emptyenv())
  }
  .session_order <<- c(setdiff(.session_order, s$id), s$id)
  while (length(.session_order) > 2) {
    rm(list = .session_order[1], envir = .sessions)
    .session_order <<- .session_order[-1]
  }
  .sessions[[s$id]] <- entry
  entry
}
session_analysis <- function(p, s, storage) {
  entry <- session_frame(s, storage)
  gates <- Filter(function(g) gate_applies_to_sample(g, s$id), p$gates %||% list())
  if (is.null(entry$masks) || !identical(entry$gates, gates)) {
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
  }
  entry$axes[[key]]
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
  result <- list(); stats <- list(); errors <- list()
  needed <- unique(c(req$sampleId, vapply(cards,function(card) if(identical(card$sampleId,"active")) req$sampleId else card$sampleId,"")))
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
  list(plots=result,stats=stats,errors=errors,workerPid=Sys.getpid())
}
# v0.4 rendering -----------------------------------------------------------
axis_ticks <- function(axis, display_range) {
  scale <- axis$scale %||% "linear"
  if (identical(scale, "log")) {
    lo <- ceiling(display_range[1]); hi <- floor(display_range[2])
    at <- if(lo<=hi) seq(lo,hi) else numeric()
    if (!length(at)) at <- mean(display_range)
    raw <- 10^at
  } else if (identical(scale, "logicle")) {
    tr <- logicleTransform(w=axis$w %||% .5,t=axis$t %||% 262144,m=axis$m %||% 4.5,a=axis$a %||% 0)
    top <- max(1,axis$t %||% 262144); decades <- 0:ceiling(log10(top*10))
    raw <- unique(c(-rev(10^decades),0,10^decades))
    at <- tr(raw)
    keep <- is.finite(at) & at >= display_range[1] & at <= display_range[2]
    raw <- raw[keep]; at <- at[keep]
  } else { at <- pretty(display_range,n=6); raw <- at }
  label <- vapply(raw,function(v) {
    if(abs(v)>=1e5 || (abs(v)>0 && abs(v)<.01)) format(v,scientific=TRUE,digits=2,trim=TRUE)
    else format(round(v,if(abs(v)<10) 2 else 0),big.mark=",",trim=TRUE,scientific=FALSE)
  },"")
  lapply(seq_along(at),function(i) list(value=unname(at[i]),label=label[i]))
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
  gate_id <- resolve_population(entry$gates,card$population); pool <- which(entry$masks[[gate_id]])
  mode <- card$mode %||% "scatter"
  x <- cached_axis(entry,card$x); y <- if(mode %in% c("histogram","cdf"))rep(0,length(x))else cached_axis(entry,card$y)
  xr <- display_limits(x[pool],card$x); yr <- if(mode %in% c("histogram","cdf"))c(0,1)else display_limits(y[pool],card$y)
  if(!mode %in% c("scatter","histogram","cdf","density","contour","pseudocolor","zebra"))fail("Unknown plot mode")
  if(!is.null(card$bins) && (length(card$bins)!=1 || !is.finite(card$bins) || card$bins<16 || card$bins>512))fail("Bins must be between 16 and 512")
  if(!is.null(card$dotSize) && (!is.finite(card$dotSize)||card$dotSize<.5||card$dotSize>8))fail("Dot size must be between 0.5 and 8")
  if(!is.null(card$dotOpacity) && (!is.finite(card$dotOpacity)||card$dotOpacity<.05||card$dotOpacity>1))fail("Dot opacity must be between 0.05 and 1")
  finite_axes <- if(mode %in% c("histogram","cdf")) is.finite(x[pool]) else is.finite(x[pool])&is.finite(y[pool])
  excluded <- sum(!finite_axes)
  in_view <- finite_axes & x[pool]>=xr[1] & x[pool]<=xr[2]
  if(!mode %in% c("histogram","cdf")) in_view <- in_view & y[pool]>=yr[1] & y[pool]<=yr[2]
  visible <- pool[in_view]; shown_count <- length(visible)
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
    dg <- density_grid(x[pool],y[pool],xr,yr,card$bins %||% 128L,card$smoothing %||% TRUE,card$contourPercent %||% 10)
    density <- dg[c("x","y","z","levels","massFractions","contours")]
    if(length(index)) {
      xi <- pmin(length(dg$x),pmax(1L,floor((x[index]-xr[1])/diff(xr)*length(dg$x))+1L)); yi <- pmin(length(dg$y),pmax(1L,floor((y[index]-yr[1])/diff(yr)*length(dg$y))+1L))
      point_density <- dg$.matrix[cbind(xi,yi)]
    }
  }
  list(id=card$id,x=card$x,y=card$y,mode=mode,sampleId=s$id,sampleName=s$name,gateId=gate_id,
       xRange=as.list(xr),yRange=as.list(yr),xTicks=axis_ticks(card$x,xr),yTicks=if(mode %in% c("histogram","cdf")) list() else axis_ticks(card$y,yr),
       points=list(),xValues=I(if(length(index)) unname(x[index]) else numeric()),yValues=I(if(length(index)) unname(y[index]) else numeric()),pointDensity=I(point_density),
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

spaced_ticks <- function(ticks,range,minimum=.12) {
  if(!length(ticks))return(ticks)
  pos<-vapply(ticks,function(t)t$value,0);valid<-which(pos>=range[1]&pos<=range[2]);if(!length(valid))return(list())
  zero<-valid[vapply(ticks[valid],function(t)identical(t$label,"0"),FALSE)]; chosen<-zero
  for(i in valid) if(!length(chosen)||all(abs(pos[i]-pos[chosen])/diff(range)>minimum))chosen<-c(chosen,i)
  ticks[sort(unique(chosen))]
}
draw_ticks <- function(d,mode) {
  xt<-spaced_ticks(d$xTicks,unlist(d$xRange));yt<-spaced_ticks(d$yTicks,unlist(d$yRange),.085)
  axis(1,at=vapply(xt,function(t)t$value,0),labels=vapply(xt,function(t)t$label,""),las=1,cex.axis=.72)
  if(!mode %in% c("histogram","cdf")) axis(2,at=vapply(yt,function(t)t$value,0),labels=vapply(yt,function(t)t$label,""),las=1,cex.axis=.72) else axis(2,las=1,cex.axis=.72)
}
heat_colors <- function(values, points=FALSE) {
  good<-sort(values[is.finite(values)]);if(!length(good))return(rep("white",length(values)))
  lo<-good[floor((length(good)-1)*.03)+1];hi<-good[floor((length(good)-1)*.98)+1]
  q<-pmax(0,pmin(1,(values-lo)/if(hi>lo)hi-lo else 1))
  ramp<-colorRamp(c(if(points)"#345b9e" else "#f6f8fa","#2f86a7","#209e70","#f4be30","#c4302b"))
  rgb(ramp(q),maxColorValue=255)
}
draw_card <- function(card,d) {
  mode<-d$mode;hist_label<-switch(d$histogramNormalize,count="Count",percent="% of events",mode="% of maximum","Count")
  plot(NA,xlim=unlist(d$xRange),ylim=unlist(d$yRange),axes=FALSE,xaxs="i",yaxs="i",xlab=card$x$channel,ylab=if(mode=="histogram")hist_label else if(mode=="cdf")"Cumulative %" else card$y$channel,main=NULL)
  col<-d$color;alpha<-d$dotOpacity;den<-d$density;pd<-unlist(d$pointDensity)
  xs<-unlist(d$xValues);ys<-unlist(d$yValues)
  if(mode=="histogram") {e<-unlist(d$histogram$edges);v<-unlist(d$histogram$counts);polygon(c(e[1],rep(e,each=2)[-c(1,2*length(e))],tail(e,1)),c(0,rep(v,each=2),0),col=col,border=NA)}
  else if(mode=="cdf") {if(length(d$cdf$x))lines(unlist(d$cdf$x),unlist(d$cdf$y),type="s",col=col,lwd=1.3)}
  else if(mode %in% c("density","zebra")) {
    nx<-length(den$x);ny<-length(den$y);z<-unlist(den$z);dx<-diff(unlist(d$xRange))/nx;dy<-diff(unlist(d$yRange))/ny
    keep<-which(z>0);cols<-if(mode=="density")heat_colors(z) else ifelse(findInterval(z,unlist(den$levels))%%2,"#dcecf0","#f7fafb")
    if(length(keep)){xx<-rep(unlist(den$x),ny);yy<-rep(unlist(den$y),each=nx);rect(xx[keep]-dx/2,yy[keep]-dy/2,xx[keep]+dx/2,yy[keep]+dy/2,col=cols[keep],border=NA)}
  } else if(mode=="pseudocolor") {if(length(xs))points(xs,ys,pch=16,cex=d$dotSize/5,col=adjustcolor(heat_colors(pd,TRUE),alpha.f=alpha+(1-alpha)*.45))}
  else if(mode=="scatter" && length(xs))points(xs,ys,pch=16,cex=d$dotSize/5,col=adjustcolor(col,alpha.f=alpha))
  if(mode %in% c("contour","zebra"))for(line in den$contours)lines(unlist(line$x),unlist(line$y),col=col,lwd=.8)
  if(mode %in% c("contour","density","zebra") && isTRUE(d$showOutliers) && length(den$levels) && length(xs)) {
    keep<-is.finite(pd)&pd<min(unlist(den$levels));if(any(keep))points(xs[keep],ys[keep],pch=16,cex=d$dotSize/5,col=adjustcolor(col,alpha.f=alpha))
  }
  draw_ticks(d,mode)
  box(bty="l")
  mtext(substr(d$sampleName,1,45),side=3,line=2.3,cex=.8,font=2)
  mtext(substr(paste(c("All events",unlist(card$population)),collapse=" / "),1,55),side=3,line=1.2,cex=.7)
  mtext(sprintf("N = %s%s",format(d$total,big.mark=","),if(d$excluded)sprintf(" | %s outside transform",format(d$excluded,big.mark=","))else""),side=3,line=.15,cex=.6)
}

draw_child_gates <- function(card,d,project,print_opts=list(),statistics=list()) {
  show_name <- isTRUE(print_opts$showGateNames)
  show_pct <- isTRUE(print_opts$showGatePercentages)
  gate_label <- function(g) { row<-Filter(function(x) identical(x$id,g$id),statistics); pct<-if(length(row)) row[[1]]$percentParent else NULL; paste0(if(show_name) g$name else "",if(show_pct && !is.null(pct)) paste0(if(show_name) " · " else "",sprintf("%.1f%%",pct)) else "") }
  gate_col <- function(g) g$color %||% "#303e48"
  same_axis <- function(a,b) identical(a[c("channel","scale","w","t","m","a")],b[c("channel","scale","w","t","m","a")])
  for(g in Filter(function(g) (identical(g$sampleId,d$sampleId)||identical(g$scope,"global"))&&identical(g$parent,d$gateId),project$gates %||% list())) {
    if(!same_axis(g$x,card$x)) next
    if(g$type=="range") { if(d$mode %in% c("histogram","cdf")){b<-unlist(g$bounds);xr<-unlist(d$xRange);if(b[2]<xr[1]||b[1]>xr[2])next;b<-pmax(xr[1],pmin(xr[2],b));yr<-unlist(d$yRange);y<-yr[2]-.12*diff(yr);lines(c(b[1],b[1],b[2],b[2]),c(y-.02*diff(yr),y,y,y-.02*diff(yr)),col=gate_col(g),lwd=1.1);xr<-unlist(d$xRange);if(show_name||show_pct) text(mean(pmax(xr[1],pmin(xr[2],b))),y+.035*diff(yr),gate_label(g),cex=.65,col=gate_col(g))};next }
    if(d$mode %in% c("histogram","cdf")) next
    if(!same_axis(g$y,card$y)) next
    if(g$type=="rectangle") {b<-unlist(g$bounds);rect(b[1],b[3],b[2],b[4],border=gate_col(g),lwd=1.1);if(show_name||show_pct) text(b[1],b[4],gate_label(g),adj=c(0,0),cex=.65,col=gate_col(g))}
    if(g$type=="polygon") polygon(matrix_from(g$vertices),border=gate_col(g),lwd=1.1);if(show_name||show_pct) {v<-matrix_from(g$vertices);text(v[1,1],v[1,2],gate_label(g),adj=c(0,0),cex=.65,col=gate_col(g))}
    if(g$type=="quadrant") abline(v=g$center[[1]],h=g$center[[2]],col=gate_col(g),lwd=1.1)
    if(g$type=="ellipse") {b<-unlist(g$bounds);th<-seq(0,2*pi,length.out=181);lines(mean(b[1:2])+diff(b[1:2])/2*cos(th),mean(b[3:4])+diff(b[3:4])/2*sin(th),col=gate_col(g),lwd=1.1);if(show_name||show_pct) text(b[1],b[4],gate_label(g),adj=c(0,0),cex=.65,col=gate_col(g))}
  }
}

draw_statistics_pages <- function(req) {
  include_stats <- isTRUE(req$includeStatistics)
  include_comp <- isTRUE(req$includeCompensation)
  for(s in req$project$samples) {
    entry<-session_analysis(req$project,s,req$storage); statistics<-entry$stats
    if(include_stats) for(chunk in split(statistics,ceiling(seq_along(statistics)/18))) {
      par(mfrow=c(1,1),mar=c(3,3,4,3));plot.new();plot.window(xlim=c(0,1),ylim=c(0,1));title(paste("Population statistics |",s$name))
      text(c(.02,.55,.72,.88),.95,c("Population","Events","% parent","% total"),adj=0,font=2); y<-.90
      for(row in chunk) { text(.02,y,substr(row$name,1,42),adj=0,cex=.8); text(c(.55,.72,.88),y,c(format(row$count,big.mark=","),if(is.null(row$percentParent))"NA"else sprintf("%.2f",row$percentParent),if(is.null(row$percentTotal))"NA"else sprintf("%.2f",row$percentTotal)),adj=0,cex=.8); y<-y-.042 }
    }
    if(include_comp) {
      config<-s$compensation; channels<-unlist(config$channels); values<-matrix_from(config$values)*100
      for(rg in split(seq_along(channels),ceiling(seq_along(channels)/8))) for(cg in split(seq_along(channels),ceiling(seq_along(channels)/8))) {
        par(mfrow=c(1,1),mar=c(3,3,4,3));plot.new();plot.window(xlim=c(0,1),ylim=c(0,1));title(paste("Spillover (%) |",s$name,"|",if(config$enabled)"APPLIED"else"NOT APPLIED"))
        xs<-seq(.25,.95,length.out=length(cg));ys<-seq(.80,.20,length.out=length(rg));text(xs,.88,channels[cg],cex=.7)
        for(i in seq_along(rg)){text(.02,ys[i],channels[rg[i]],adj=0,cex=.8);text(xs,ys[i],sprintf("%.2f",values[rg[i],cg]),cex=.8)}
      }
    }
  }
}

export_vector <- function(req,kind=c("pdf","svg"),single=FALSE) {
  kind<-match.arg(kind); ext<-paste0("\\.",kind,"$"); if(!grepl(ext,req$path,ignore.case=TRUE)) fail(paste(toupper(kind),"output has wrong extension"))
  include_plots <- !identical(req$includePlots, FALSE)
  data<-worksheet(req); if(length(data$errors)) fail(paste(unlist(data$errors),collapse="\n"))
  cards<-req$plots %||% list(); cards<-cards[order(vapply(cards,function(c)c$top %||% 0,0),vapply(cards,function(c)c$left %||% 0,0))]
  if(single) cards<-cards[1]
  if(include_plots && !length(cards)) fail("Worksheet is empty")
  if(!include_plots && kind!="pdf") fail("SVG output requires plots")
  tmp<-tempfile(tmpdir=dirname(req$path),fileext=paste0(".",kind)); closed<-FALSE
  if(kind=="pdf") grDevices::cairo_pdf(tmp,width=if(single)7 else 11.69,height=if(single)5.5 else 8.27,onefile=TRUE,family="Yu Gothic") else grDevices::svg(tmp,width=7,height=5.5,onefile=TRUE,family="Yu Gothic")
  on.exit({if(!closed)dev.off();if(file.exists(tmp))unlink(tmp)},add=TRUE)
  if(include_plots) {
    # Preserve the worksheet coordinates on one landscape page, scaled as a whole.
    board_w<-max(vapply(cards,function(c)(c$left %||% 0)+(c$width %||% 344)+30,0),1120)
    board_h<-max(vapply(cards,function(c)(c$top %||% 0)+(c$height %||% 314)+40,0),710)
    for(i in seq_along(cards)) { card<-cards[[i]]; x1<-(card$left %||% 0)/board_w; x2<-((card$left %||% 0)+(card$width %||% 344))/board_w; y1<-(card$top %||% 0)/board_h; y2<-((card$top %||% 0)+(card$height %||% 314))/board_h; par(fig=c(x1,x2,1-y2,1-y1),new=i>1,mar=c(1.7,1.7,1.7,.4),bg="white"); d<-data$plots[[card$id]]; draw_card(card,d); draw_child_gates(card,d,req$project,req$worksheetPrint %||% list(),data$stats[[d$sampleId]] %||% list()) }
  }
  if(kind=="pdf" && (isTRUE(req$includeStatistics) || isTRUE(req$includeCompensation))) draw_statistics_pages(req)
  dev.off();closed<-TRUE; if(!file.rename(tmp,req$path)){if(!file.copy(tmp,req$path,overwrite=TRUE))fail(paste("Cannot write",kind));unlink(tmp)};list(path=normalizePath(req$path,winslash="/"),plots=if(include_plots)length(cards)else 0)
}

.dispatch_core <- dispatch
dispatch <- function(req) {
  if(identical(req$action,"statistics_csv")) return(export_statistics_csv(req))
  if(identical(req$action,"plot_pdf")) return(export_vector(req,"pdf",TRUE))
  if(identical(req$action,"plot_svg")) return(export_vector(req,"svg",TRUE))
  if(identical(req$action,"worksheet_pdf")) return(export_vector(req,"pdf",FALSE))
  if(identical(req$action,"worksheet_report_pdf")) {
    templates<-req$plots %||% list(); cards<-list(); offset<-0
    for(s in req$project$samples) { for(card in templates) if(identical(card$sampleId,"active")) { card$id<-paste0(s$id,"/",card$id);card$sampleId<-s$id;card$top<-(card$top %||% 0)+offset;cards[[length(cards)+1]]<-card }; offset<-offset+max(1,vapply(templates,function(c)(c$top %||% 0)+(c$height %||% 0),0))+40 }
    for(card in templates) if(!identical(card$sampleId,"active")){card$top<-(card$top %||% 0)+offset;cards[[length(cards)+1]]<-card}
    req$plots<-cards
    if(is.null(req$includePlots)) req$includePlots<-TRUE
    if(is.null(req$includeStatistics)) req$includeStatistics<-TRUE
    if(is.null(req$includeCompensation)) req$includeCompensation<-TRUE
    return(export_vector(req,"pdf",FALSE))
  }
  if(identical(req$action,"worksheet"))return(worksheet(req))
  if(identical(req$action,"health"))return(c(version_info(),list(workerPid=Sys.getpid())))
  .dispatch_core(req)
}
