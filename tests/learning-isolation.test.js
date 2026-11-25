import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = new URL("../", import.meta.url).pathname, read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const walk = (d, o = []) => { for (const f of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { if (["node_modules", "dist", ".git"].includes(f.name)) continue; const p = path.join(d, f.name); f.isDirectory() ? walk(p, o) : o.push(p); } return o; };
const LEARN = ["functions/api/_learning-core.js", "functions/api/_learning-adapters.js", "functions/api/_learning-diagnostics.js", "functions/api/_learning-lab.js", "functions/api/_learning-report.js", "scripts/learning-run.js", "src/learning/view.js", "src/learning/mount.js", "src/learning/learning.css"];

test("isolamento: i motori e i componenti operativi non conoscono CONTINUOUS LEARNING", () => {
  const protectedFiles = [...walk("functions").filter((f) => !/_learning-/.test(f)), ...walk("scripts").filter((f) => !/learning-run/.test(f)), "src/main.js", "src/football.js", "src/sport.js", "src/format.js", ...walk("src/tennis").filter((f) => f.endsWith(".js") && !/app\.js$/.test(f)), ...walk(".github")].filter((f) => fs.existsSync(path.join(root, f)));
  for (const f of protectedFiles) assert.ok(!/learning/i.test(read(f)), `${f} non deve nominare CONTINUOUS LEARNING`);
});

test("importatori ammessi: solo l'interfaccia (tennis/app.js e monitor-tab.js, tramite mount) e lo script; nessun workflow", () => {
  const users = walk(".").filter((f) => /\.(js|mjs|yml|html)$/.test(f) && !f.startsWith("tests/") && !LEARN.includes(f) && /learning[\/-]|_learning/.test(read(f))).sort();
  assert.deepEqual(users, ["src/monitor-tab.js", "src/tennis/app.js"]);
  assert.ok(!walk(".github").some((f) => /learning/i.test(read(f))), "nessun workflow esistente è stato modificato per attivarlo");
});

test("i moduli nuovi non importano nulla di operativo: solo se stessi (e node:)", () => {
  for (const f of LEARN.filter((x) => x.endsWith(".js"))) for (const m of read(f).matchAll(/from\s+"([^"]+)"|import\("([^"]+)"\)/g)) { const t = m[1] ?? m[2]; assert.ok(/^node:|^\.\/_learning|^\.\.\/functions\/api\/_learning|^\.\/(view|mount)\.js$|^\.\.\/format\.js$|^\.\/learning\.css$/.test(t), `${f} importa ${t}`); }
  assert.ok(!/KEYSET|keyset|_tennis-model|_tennis-history|predictMatch|loadHistory/.test(LEARN.filter((x) => x.endsWith(".js")).map(read).join("\n").replace(/\/\*[\s\S]*?\*\//g, "")), "nessun riferimento ai motori");
});

test("nessuna variabile d'ambiente o secret nuovi e nessuna migrazione aggiunta", () => {
  const env = LEARN.filter((f) => f.endsWith(".js")).map(read).join("\n").match(/env\.([A-Z_]+)/g) ?? []; assert.deepEqual([...new Set(env)].sort(), ["env.SUPABASE_SERVICE_ROLE_KEY", "env.SUPABASE_URL"]);
  assert.ok(!fs.readdirSync(path.join(root, "supabase/migrations")).some((f) => /learning/i.test(f)));
});
