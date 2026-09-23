invisible(Sys.setlocale("LC_CTYPE", "English_United States.utf8"))
ip <- installed.packages()
packages <- unique(c("flowCore", "jsonlite", "xml2",
  unlist(tools::package_dependencies(c("flowCore", "jsonlite", "xml2"), db=ip,
    which=c("Depends", "Imports", "LinkingTo"), recursive=TRUE)),
  rownames(ip)[ip[,"Priority"] %in% "base"]))
packages <- intersect(packages, rownames(ip))
root <- normalizePath("src-tauri/runtime", winslash="/", mustWork=TRUE)
dest <- file.path(root,"R")
dir.create(dest, showWarnings=FALSE)
copy_checked <- function(from, to) {
  if (!all(file.copy(from, to, recursive=dir.exists(from), overwrite=TRUE, copy.date=TRUE)))
    stop(paste("Failed to copy",from))
}
for (dir in c("bin","doc","etc","include","lib","modules","share","src","Tcl")) {
  from <- file.path(R.home(),dir)
  if (dir.exists(from)) copy_checked(from,dest)
}
for (file in c("COPYING","COPYRIGHTS","README","README.R-4.5.1","CHANGES")) {
  from<-file.path(R.home(),file); if(file.exists(from))copy_checked(from,dest)
}
dir.create(file.path(dest,"library"),showWarnings=FALSE)
manifest<-lapply(sort(packages),function(p){
  copy_checked(file.path(ip[p,"LibPath"],p),file.path(dest,"library"))
  desc<-read.dcf(file.path(ip[p,"LibPath"],p,"DESCRIPTION"))[1,]
  field<-function(key)if(key %in% names(desc))unname(desc[key]) else NULL
  list(package=p,version=field("Version"),license=field("License"),priority=field("Priority"),repository=field("Repository"),git=field("git_last_commit"))
})
jsonlite::write_json(list(r=as.character(getRversion()),packages=manifest),file.path(root,"r-manifest.json"),pretty=TRUE,auto_unbox=TRUE,null="null")
cat("Staged R",as.character(getRversion()),"and",length(packages),"packages\n")
