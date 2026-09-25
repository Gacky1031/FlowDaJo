if (.Platform$OS.type == "windows") invisible(Sys.setlocale("LC_CTYPE", "English_United States.utf8"))
args <- commandArgs(trailingOnly = FALSE)
script <- sub("^--file=", "", args[grepl("^--file=", args)][1])
suppressPackageStartupMessages(library(jsonlite))
source(file.path(dirname(normalizePath(script)), "core.R"), encoding = "UTF-8")
source(file.path(dirname(normalizePath(script)), "diva.R"), encoding = "UTF-8")
source(file.path(dirname(normalizePath(script)), "worksheet.R"), encoding = "UTF-8")
respond <- function(input) {
  result <- tryCatch(list(ok=TRUE,data=dispatch(fromJSON(input,simplifyVector=FALSE))),
                     error=function(e)list(ok=FALSE,error=conditionMessage(e)))
  cat(toJSON(result,auto_unbox=TRUE,null="null",na="null",digits=12),"\n",sep="")
  flush(stdout())
  result$ok
}
input <- file("stdin",open="r",encoding="UTF-8")
if ("--persistent" %in% commandArgs(trailingOnly=TRUE)) {
  repeat {
    line <- readLines(input,n=1,warn=FALSE)
    if(!length(line)) break
    if(nzchar(line)) respond(line)
  }
} else {
  ok <- respond(paste(readLines(input,warn=FALSE),collapse="\n"))
  if(!ok) quit(status=1)
}
close(input)
