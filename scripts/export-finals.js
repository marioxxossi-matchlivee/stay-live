#!/usr/bin/env node
/** Esporta le partite finali (vista backtest_finals) in finals.json per i backtest. Serve SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY. */
import fs from "node:fs";
import { supabaseGetAll } from "../functions/api/_lib.js";

const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !process.env[k]);
if (need.length) { console.error(`Mancano: ${need.join(", ")}`); process.exit(1); }
const rows = await supabaseGetAll(process.env, "backtest_finals", { select: "*", order: "kickoff_at.asc" }, 1000, 40);
fs.writeFileSync(process.argv[2] || "finals.json", JSON.stringify(rows));
console.log(`${rows.length} partite finali esportate`);
