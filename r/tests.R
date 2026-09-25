if (.Platform$OS.type == "windows") invisible(Sys.setlocale("LC_CTYPE", "English_United States.utf8"))
source("r/core.R", encoding = "UTF-8")
source("r/diva.R", encoding = "UTF-8")
source("r/worksheet.R", encoding = "UTF-8")
suppressPackageStartupMessages(library(jsonlite))
passed <- 0L
test <- function(name, code) { force(code); passed <<- passed + 1L; cat("PASS", name, "\n") }
errors <- function(code, pattern) { e <- tryCatch({force(code); NULL},error = identity); stopifnot(inherits(e,"error"),grepl(pattern,conditionMessage(e))) }
storage <- tempfile(); dir.create(storage)
ch <- c("FITC-A","PE-A","APC-A")
truth <- matrix(c(-50, 20, 100, 400, -25, 70, 3000, 900, -100),3,byrow=TRUE,dimnames=list(NULL,ch))
spill <- matrix(c(1,.13,.02,.025,1,.07,.01,.035,1),3,byrow=TRUE,dimnames=list(ch,ch))
observed <- truth %*% spill
config <- list(enabled=TRUE, channels=as.list(ch),values=rows(spill))
test("asymmetric compensation and preserved negatives", {actual <- exprs(apply_compensation(flowFrame(observed),config));stopifnot(max(abs(actual-truth))<1e-4,actual[1,1]<0)})
test("detector order mapping", {actual <- exprs(apply_compensation(flowFrame(observed[,c(3,1,2)]),config));stopifnot(max(abs(actual[,ch]-truth))<1e-4)})
test("raw frame stays unchanged", {f<-flowFrame(observed);before<-exprs(f);apply_compensation(f,config);stopifnot(identical(exprs(f),before))})
test("singular spill rejected", {bad<-config;bad$values<-rows(matrix(1,3,3));errors(apply_compensation(flowFrame(observed),bad),"singular")})
test("unknown detector rejected", {bad<-config;bad$channels[[1]]<-"wrong";errors(apply_compensation(flowFrame(observed),bad),"detector")})
xy <- cbind(X=c(-1,0,1,2,0),Y=c(-1,0,1,-1,1));f<-flowFrame(xy)
x<-axis_default("X");x$scale<-"linear";y<-axis_default("Y");y$scale<-"linear"
g<-list(id="p",name="P",parent="root",type="rectangle",x=x,y=y,bounds=as.list(c(-.5,1.5,-.5,1.5)))
test("rectangle gate full event count",stopifnot(sum(gate_masks(f,list(g))$p)==3))
test("parent intersection", {child<-g;child$id<-"c";child$parent<-"p";child$bounds<-as.list(c(-10,10,-10,10));stopifnot(identical(gate_masks(f,list(child,g))$c,gate_masks(f,list(g))$p))})
test("cycle rejected",{a<-g;b<-g;a$id<-"a";a$parent<-"b";b$id<-"b";b$parent<-"a";errors(gate_masks(f,list(a,b)),"cycle")})
test("missing parent rejected",{bad<-g;bad$parent<-"missing";errors(gate_masks(f,list(bad)),"Missing parent")})
test("quadrants partition including equality",{gs<-lapply(1:4,function(q)list(id=paste0("q",q),type="quadrant",parent="root",x=x,y=y,center=list(0,0),quadrant=q));m<-gate_masks(f,gs);stopifnot(all(Reduce(`+`,m[-1])==1),m$q2[2])})
test("polygon through flowCore",{poly<-g;poly$type<-"polygon";poly$vertices<-list(list(-.5,-.5),list(1.5,-.5),list(1.5,1.5),list(-.5,1.5));stopifnot(sum(gate_masks(f,list(poly))$p)==3)})
test("logicle monotonic and finite for negatives",{a<-axis_default("FITC-A");v<-axis_values(flowFrame(matrix(c(-100,0,100),ncol=1,dimnames=list(NULL,"FITC-A"))),a);stopifnot(all(is.finite(v)),all(diff(v)>0))})
demo<-dispatch(list(action="demo",storage=storage))
p<-list(schema="flowdesk-r/1",name="Validation demo",samples=demo$samples,gates=list(),selectedGate="root",notes="",importWarnings=demo$warnings)
test("full demo analysis",{a<-analyze(p,"demo-42",storage);stopifnot(a$stats[[1]]$count==16000,length(a$plots)==4,length(a$plots[[1]]$points)==16000)})
test("global gate applies to every sample",{
  second<-demo$samples[[1]];second$id<-"demo-43";q<-p;q$samples<-list(p$samples[[1]],second)
  global<-list(id="global",name="Global cells",sampleId="demo-42",scope="global",parent="root",type="rectangle",x=axis_default("FSC-A"),y=axis_default("SSC-A"),bounds=list(0,1e9,0,1e9));q$gates<-list(global)
  a<-analyze(q,"demo-43",storage);stopifnot(length(a$stats)==2,a$stats[[2]]$id=="global",a$stats[[2]]$count==16000)
})
test("zero parent percentage is null",{g<-list(id="zero",name="Empty",sampleId="demo-42",parent="root",type="rectangle",x=axis_default("FSC-A"),y=axis_default("SSC-A"),bounds=list(-10,-5,-10,-5));child<-g;child$id<-"child";child$parent<-"zero";q<-p;q$gates<-list(g,child);a<-analyze(q,"demo-42",storage);stopifnot(is.null(a$stats[[3]]$percentParent),a$stats[[3]]$count==0)})
path<-file.path(storage,"demo.fcs");write.FCS(demo_frame(),path)
test("flowCore FCS import",{i<-import_samples(list(paths=list(path),storage=storage));stopifnot(i$samples[[1]]$events==16000,identical(unname(vapply(i$samples[[1]]$channels,`[[`,"","id")),unname(colnames(exprs(demo_frame())))));p$samples<-i$samples})
test("project save/load roundtrip",{file<-file.path(storage,"project.json");dispatch(list(action="save",project=p,path=file,storage=storage));restored<-dispatch(list(action="load",path=file,storage=storage));stopifnot(identical(restored$samples[[1]]$md5,p$samples[[1]]$md5))})
test("changed source rejected even with cache",{cat("changed",file=path,append=TRUE);errors(read_frame(p$samples[[1]],storage),"changed")})
test("DIVA XML safely rejects entities",{dir<-file.path(storage,"diva");dir.create(dir);write.FCS(demo_frame(),file.path(dir,"tube.fcs"));writeLines('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Experiment name="test"/>',file.path(dir,"export.xml"));i<-import_samples(list(paths=list(dir),storage=storage));stopifnot(length(i$samples)==1,grepl("DTD/entity",i$warnings[[1]]))})
test("DIVA experiment metadata and explicit warning",{dir<-file.path(storage,"diva2");dir.create(dir);write.FCS(demo_frame(),file.path(dir,"tube.fcs"));writeLines('<Experiment name="T cells"><Tube name="One"/></Experiment>',file.path(dir,"export.xml"));i<-import_samples(list(paths=list(dir),storage=storage));stopifnot(i$divaMetadata[[1]]$experiments[[1]]=="T cells",grepl("not restored",i$warnings[[1]]))})
test("DIVA worksheet gates inherit experiment-scale Logicle widths", {
  local <- xml2::read_xml("<instrument_settings><parameter name='PE-A'><is_log>true</is_log><manual_biexp_scale>-1</manual_biexp_scale><biexp_scale>-1</biexp_scale><comp_biexp_scale>-1</comp_biexp_scale></parameter></instrument_settings>")
  global <- xml2::read_xml("<instrument_settings><parameter name='PE-A'><is_log>true</is_log><manual_biexp_scale>171</manual_biexp_scale></parameter></instrument_settings>")
  template_doc <- xml2::read_xml("<worksheet_template><instrument_settings><parameter name='PE-A'><is_log>true</is_log><manual_biexp_scale>-1</manual_biexp_scale><biexp_scale>-1</biexp_scale><comp_biexp_scale>-1</comp_biexp_scale></parameter></instrument_settings><gates><gate fullname='All Events\\P'><is_x_parameter_scaled>true</is_x_parameter_scaled><is_y_parameter_scaled>true</is_y_parameter_scaled><x_parameter_scale_value>171</x_parameter_scale_value><y_parameter_scale_value>171</y_parameter_scale_value><region type='RECTANGLE_REGION' xparm='PE-A' yparm='PE-A'><points><point x='100' y='200'/><point x='5000' y='6000'/></points></region></gate></gates></worksheet_template>")
  imported <- diva_gate_import(template_doc, "Current", TRUE, "0123456789", 1, diva_channel_settings(global))
  gate <- imported$gates[[1]]
  bounds <- as.numeric(unlist(gate$bounds))
  stopifnot(abs(gate$x$w - diva_width(171)) < 1e-12, abs(gate$y$w - diva_width(171)) < 1e-12,
            all(is.finite(bounds)), bounds[1] < bounds[2])
})
test("DIVA scaled gates use their own biexponential transform before the display transform", {
  display <- list(scale="logicle",w=diva_width(67),t=262144,m=4.5,a=0)
  coordinate <- 952.3255813953489
  gate_transform <- logicleTransform(w=diva_width(45),t=262144,m=4.5,a=0)
  display_transform <- logicleTransform(w=display$w,t=262144,m=4.5,a=0)
  expected <- display_transform(inverseLogicleTransform(gate_transform)(coordinate/4096*4.5))
  actual <- diva_axis_values(coordinate,display,TRUE,45)
  stopifnot(abs(actual-expected)<1e-10,
            abs(actual-display_transform(coordinate))>.1,
            is.finite(diva_axis_values(c(-48,4096),display,TRUE,88)))
  stopifnot(abs(diva_axis_values(3,display,FALSE,31)-display_transform(1000))<1e-10)
})
test("edge gates retain events beyond the plotted border", {
  f <- flowFrame(matrix(c(1,5,12,5,20,5),ncol=2,byrow=TRUE,
                        dimnames=list(NULL,c("x","y"))))
  ax <- list(channel="x",scale="linear"); ay <- list(channel="y",scale="linear")
  g <- list(id="edge",parent="root",type="rectangle",x=ax,y=ay,
            bounds=list(0,10,0,10),edgeExtent=list(xMax=10))
  stopifnot(identical(as.logical(gate_masks(f,list(g))$edge),c(TRUE,TRUE,TRUE)))
  g$edgeExtent <- NULL
  stopifnot(identical(as.logical(gate_masks(f,list(g))$edge),c(TRUE,FALSE,FALSE)))
})
test("axis ticks use readable superscript powers", {
  stopifnot(axis_tick_label(1000) == "10³", axis_tick_label(-1000) == "−10³",
            axis_tick_label(1500) == "1.5×10³", axis_tick_label(.001) == "10⁻³")
})
test("statistics widget hides only selected population paths", {
  parent <- list(id="p1",name="P1",parent="root")
  child <- list(id="p2",name="P2",parent="p1")
  statistics <- list(list(id="root"),list(id="p1"),list(id="p2"))
  widget <- list(hiddenPopulationPaths=list('["P1"]'))
  visible <- visible_widget_statistics(widget,statistics,list(parent,child))
  stopifnot(identical(vapply(visible,function(row)row$id,""),c("root","p2")),
            identical(statistics_population_key("p2",list(parent,child)),'["P1","P2"]'))
})
test("surviving deepest gates keep dot colors after a sibling is deleted", {
  f <- flowFrame(matrix(c(1,1,2,2,3,3,4,4),ncol=2,byrow=TRUE,dimnames=list(NULL,c("X","Y"))))
  ax <- list(channel="X",scale="linear",w=.5,t=262144,m=4.5,a=0)
  ay <- ax;ay$channel <- "Y"
  parent <- list(id="parent",name="Parent",sampleId="s",parent="root",type="rectangle",x=ax,y=ay,bounds=list(0,5,0,5),color="#aa0000")
  left <- parent;left$id <- "left";left$name <- "Left";left$parent <- "parent";left$bounds <- list(0,2.5,0,5);left$color <- "#0000aa"
  deep <- left;deep$id <- "deep";deep$name <- "Deep";deep$parent <- "left";deep$bounds <- list(0,1.5,0,5);deep$color <- "#aaaa00"
  right <- parent;right$id <- "right";right$name <- "Right";right$parent <- "parent";right$bounds <- list(2.5,5,0,5);right$color <- "#00aa00"
  paint <- function(gates) {
    entry <- list(frame=f,gates=gates,masks=gate_masks(f,gates),axes=new.env(parent=emptyenv()))
    card <- list(id="plot",x=ax,y=ay,mode="scatter",population=list("Parent"))
    worksheet_plot(entry,card,list(id="s",name="Sample",compensation=list(enabled=FALSE)))$pointColors
  }
  stopifnot(identical(as.character(paint(list(parent,left,deep,right))),c("#aaaa00","#0000aa","#00aa00","#00aa00")))
  stopifnot(identical(as.character(paint(list(parent,left,deep))),c("#aaaa00","#0000aa","#aa0000","#aa0000")))
  stopifnot(identical(as.character(paint(list(deep,left,parent))),c("#aaaa00","#0000aa","#aa0000","#aa0000")))
})
test("worksheet cache recalculates surviving gate colors after deletion", {
  ax <- axis_default("FSC-A");ay <- axis_default("SSC-A")
  parent <- list(id="cache-parent",name="Parent",sampleId="demo-42",parent="root",type="rectangle",x=ax,y=ay,bounds=list(0,1e9,0,1e9),color="#aa0000")
  low <- parent;low$id <- "cache-low";low$name <- "Low";low$parent <- parent$id;low$bounds <- list(0,1e5,0,1e9);low$color <- "#0000aa"
  deepest <- low;deepest$id <- "cache-deep";deepest$name <- "Deep";deepest$bounds <- list(0,6e4,0,1e9);deepest$parent <- low$id;deepest$color <- "#aaaa00"
  high <- parent;high$id <- "cache-high";high$name <- "High";high$parent <- parent$id;high$bounds <- list(1e5,1e9,0,1e9);high$color <- "#00aa00"
  project <- list(schema="flowdesk-r/1",samples=list(demo$samples[[1]]),gates=list(parent,low,deepest,high))
  card <- list(id="colors",sampleId="active",population=list(),mode="scatter",x=ax,y=ay)
  request <- list(project=project,sampleId="demo-42",plots=list(card),storage=storage)
  before <- worksheet(request)$plots$colors$pointColors
  request$project$gates <- list(parent,low,deepest)
  after <- worksheet(request)$plots$colors$pointColors
  stopifnot(any(before=="#00aa00"),any(after=="#aaaa00"),any(after=="#0000aa"),
            !any(after=="#00aa00"),length(unique(after))>=3)
})
test("DIVA automatic scale uses the compensated scale when compensation is enabled", {
  settings <- xml2::read_xml("<instrument_settings><compensation_enabled>true</compensation_enabled><parameter name='PE-A'><is_log>true</is_log><manual_biexp_scale>0</manual_biexp_scale><biexp_scale>42</biexp_scale><comp_biexp_scale>74</comp_biexp_scale></parameter></instrument_settings>")
  axis <- diva_axis("PE-A", diva_channel_settings(settings))
  stopifnot(abs(axis$w - diva_width(74)) < 1e-12)
})
cat(passed,"tests passed\n")
