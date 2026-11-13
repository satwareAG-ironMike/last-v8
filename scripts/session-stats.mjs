// The V12 refactoring session, measured from the local opencode database.
//
// Why this file exists: the README's session-statistics tables are the same
// class of claim the V8 measured the same way ("from the full session
// database, not estimated"), and a repeated fact must have a named generator
// (AGENTS.md Honesty: generated drift). Re-run to recompute:
//
//   node scripts/session-stats.mjs [session-id]
//
// Reads the opencode SQLite database the running client writes
// ($OPENCODE_DB overrides the path). Exits nonzero and prints nothing but the
// problem if the session row is missing, so a stale id cannot quietly pass.
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const DB = process.env.OPENCODE_DB ?? `${homedir()}/.local/share/opencode/opencode.db`;
// The session that refactored the V8 tree into the V12 (branch v12).
const SESSION = process.argv[2] ?? 'ses_e2dd553f6ffeLqxXE3EiI5w6oQ';

if (!existsSync(DB)) {
  console.error(`session-stats: no opencode database at ${DB}`);
  process.exit(1);
}

const db = new DatabaseSync(DB, { readOnly: true });
const s = db.prepare(
  `select title, model, time_created, time_updated, tokens_input, tokens_output,
          tokens_reasoning, tokens_cache_read, tokens_cache_write, cost
     from session_v2 where id = ?`,
).get(SESSION);
if (!s) {
  console.error(`session-stats: session ${SESSION} not in ${DB}`);
  process.exit(1);
}

const types = db.prepare(
  `select type, count(*) n from session_message where session_id = ? group by type`,
).all(SESSION);
const at = (t) => (types.find((r) => r.type === t)?.n ?? 0);

const tools = db.prepare(
  `select json_extract(jv.value,'$.name') name,
          sum(case when json_extract(jv.value,'$.state.status') = 'error' then 1 else 0 end) errs,
          count(*) n
     from session_message sm, json_each(json_extract(sm.data,'$.content')) jv
    where sm.session_id = ? and json_extract(jv.value,'$.type') = 'tool'
    group by 1 order by n desc`,
).all(SESSION);
const toolTotal = tools.reduce((a, r) => a + r.n, 0);
const toolErrs = tools.reduce((a, r) => a + r.errs, 0);

// Model generation time: the window each assistant message spent streaming.
const genMs = db.prepare(
  `select coalesce(sum(json_extract(json_extract(data,'$.time'),'$.streamed')
                  - json_extract(json_extract(data,'$.time'),'$.created')), 0) g
     from session_message
    where session_id = ? and type = 'assistant'
      and json_extract(data,'$.time.streamed') is not null`,
).get(SESSION).g;

const f2 = (x) => Number(x.toFixed(2));
const mmt = (x) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)} M` : `${Math.round(x / 1e3)} K`);
const spanH = (s.time_updated - s.time_created) / 3.6e6;
const genH = genMs / 3.6e6;
const promptTotal = s.tokens_input + s.tokens_cache_read + s.tokens_cache_write;
const cachePct = promptTotal ? (100 * s.tokens_cache_read) / promptTotal : 0;
const tokPerSec = genMs > 0 ? s.tokens_output / (genMs / 1000) : 0;
const model = JSON.parse(s.model ?? '{}');

const rows = [
  ['Session', `${s.title} (${SESSION})`],
  ['Model', `${model.id ?? '?'} via ${model.providerID ?? '?'} (local, cost ${s.cost})`],
  ['Span', `${f2(spanH)} h wall, ${new Date(s.time_created).toISOString()} .. ${new Date(s.time_updated).toISOString()} (updated as the session lives)`],
  ['Model generation time', `${f2(genH)} h streaming across ${at('assistant')} assistant turns`],
  ['Prompt tokens processed', `${mmt(promptTotal)} (${f2(cachePct)} % served from prompt cache)`],
  ['Tokens generated', `${mmt(s.tokens_output)} at ${f2(tokPerSec)} tok/s sustained`],
  ['Context compactions', String(at('compaction'))],
  ['User messages', String(at('user'))],
  ['Tool calls', `${toolTotal} (${tools.map((r) => `${r.name} ${r.n}`).join(', ')})`],
  ['Tool errors', `${toolErrs} of ${toolTotal} calls`],
];
for (const [k, v] of rows) console.log(`${k}: ${v}`);
console.log('SESSION STATS OK');
