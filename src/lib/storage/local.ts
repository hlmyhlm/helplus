import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import type { FileStore } from "./index";

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

export function localStore(root: string): FileStore {
  const full = (key: string) => {
    if (!SAFE_KEY.test(key) || key.split("/").includes("..")) throw new Error("bad storage key");
    return path.join(root, ...key.split("/"));
  };
  return {
    async put(key, data) {
      const file = full(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    },
    async get(key) {
      return readFile(full(key));
    },
    async remove(key) {
      await rm(full(key), { force: true });
    },
  };
}
