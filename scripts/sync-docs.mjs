import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const destination=join(projectRoot,"web/public/wiki");
mkdirSync(destination,{recursive:true});
const documents=[
  ["README.md","overview.md"],
  ["docs/demo.md","demo.md"],
  ["docs/api.md","api.md"],
  ["docs/architecture.md","architecture.md"],
  ["docs/development.md","development.md"],
  ["docs/tls.md","tls.md"]
];
for(const [source,target] of documents)copyFileSync(join(projectRoot,source),join(destination,target));
console.log("Wiki documentation synchronized from repository Markdown");
