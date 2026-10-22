import { openSync, closeSync, writeFileSync, fsyncSync, renameSync } from "node:fs";
import path from "node:path";

export function durableDeploymentWrite(file, content, mode = 0o640) {
  const temporary = `${file}.next-${process.pid}`;
  const fd = openSync(temporary, "w", mode);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, file);
  // Windows does not support opening a directory for fsync. Linux production does.
  if (process.platform !== "win32") {
    const directory = openSync(path.dirname(file), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
}
