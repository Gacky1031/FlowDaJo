if (.Platform$OS.type == "windows") {
  invisible(Sys.setlocale("LC_CTYPE", "English_United States.utf8"))
  user_lib <- file.path(Sys.getenv("LOCALAPPDATA"), "R", "win-library", paste(R.version$major, strsplit(R.version$minor, ".", fixed=TRUE)[[1]][1], sep="."))
  dir.create(user_lib, showWarnings=FALSE, recursive=TRUE)
  .libPaths(c(user_lib, .libPaths()))
}
packages <- c("jsonlite", "xml2", "BiocManager")
missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing)) install.packages(missing, repos = "https://cloud.r-project.org")
if (!requireNamespace("flowCore", quietly = TRUE)) BiocManager::install("flowCore", ask = FALSE, update = FALSE)
cat("R and flowCore ready\n")
