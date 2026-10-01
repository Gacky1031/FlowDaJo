import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

test("vector exports respect label positions, point sizes, visibility and quadrant/range labels", () => {
  const script = String.raw`
    assign("%||%", function(x,y) if(is.null(x)) y else x)
    dispatch <- function(req) NULL
    source("r/worksheet.R")
    pdf(tempfile(fileext=".pdf"),width=7,height=5,pointsize=12)
    plot(NA,xlim=c(0,100),ylim=c(0,100),xaxs="i",yaxs="i")
    labels <- list()
    text <- function(x,y,labels,adj,cex,col) {
      record <- list(x=x,y=y,label=labels,cex=cex)
      assign("labels",c(get("labels",envir=.GlobalEnv),list(record)),envir=.GlobalEnv)
    }
    axis <- list(channel="FSC-A",scale="linear",w=.5,t=262144,m=4.5,a=0)
    gate <- list(id="g",name="P1",sampleId="s",type="rectangle",x=axis,y=axis,bounds=list(10,40,10,40))
    data <- list(sampleId="s",mode="scatter",xRange=list(0,100),yRange=list(0,100),displayGateIds=list("g"))
    card <- list(x=axis,y=axis,gateLabelFontSizePt=18,gateLabelPositions=list(g=list(x=.6,y=.35)))
    statistics <- list(list(id="g",percentParent=25))
    draw <- function() draw_child_gates(card,data,list(gates=list(gate)),statistics)
    draw()
    stopifnot(length(labels)==1,labels[[1]]$x==60,labels[[1]]$y==65,labels[[1]]$cex==1.5)
    card$showGateNames <- FALSE
    labels <- list(); draw(); stopifnot(labels[[1]]$label=="25.0%")
    card$showGatePercentages <- FALSE
    labels <- list(); draw(); stopifnot(length(labels)==0)
    card$showGateNames <- TRUE; card$showGatePercentages <- TRUE
    gate$type <- "quadrant"; gate$quadrant <- 2; gate$center <- list(50,50)
    labels <- list(); draw(); stopifnot(length(labels)==1,labels[[1]]$x==60,labels[[1]]$y==65)
    gate$type <- "range"; gate$bounds <- list(10,30); data$mode <- "histogram"
    labels <- list(); draw(); stopifnot(length(labels)==1,labels[[1]]$x==60,labels[[1]]$y==65)
    card$gateLabelPositions$g <- list(x=-3,y=2)
    labels <- list(); draw(); stopifnot(labels[[1]]$x==0,labels[[1]]$y==0)
    card$gateLabelFontSizePt <- NULL
    labels <- list(); draw(); stopifnot(labels[[1]]$cex==8.25/12)
    dev.off()
  `;
  const mac = process.platform === "darwin";
  execFileSync(resolve(mac ? "src-tauri/runtime/R/bin/exec/R" : "src-tauri/runtime/R/bin/Rscript.exe"),
    mac ? ["--vanilla", "--slave"] : ["--vanilla", "-"], {
      input: script,
      env: { ...process.env, R_HOME: resolve("src-tauri/runtime/R"), R_LIBS_USER: resolve("src-tauri/runtime/R/library") },
    });
});
