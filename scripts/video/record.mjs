/* Records the FIREVERSE walkthrough: a stage page (stage.html) with the live app inside, driven by Playwright,
   narrated with the macOS `say` voice, encoded by ffmpeg. Every number on the tiles is read from the app while recording.
   Needs the server on 127.0.0.1:8000.   usage: node scripts/video/record.mjs [out.mp4] */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..'), BASE = 'http://127.0.0.1:8000';
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'docs/video/fireverse-roles-walkthrough.mp4'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-video-')), VOICE = process.env.FV_VOICE || 'Samantha';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SAY = [
  'Fireverse turns satellite fire detections into one question. What is the smoke about to cross? Start by picking who you are.',
  'Six roles. Fire brigade, grid operator, road patrol, clinic or school lead, resident, and analyst. Five get a simple page. The analyst keeps the full workspace.',
  'The grid operator sees one list: power lines with a fire upwind. The big numbers come straight from the latest satellite data for Paraguay.',
  'Tap a card and it turns over into a bulletin. Copy it, read it aloud for radio, or send it by WhatsApp. The short form fits in one text message.',
  'The shift briefing has three steps. Check the satellite clock, review the top items, send a bulletin. The ring fills only with what you actually did. No points and no badges.',
  'A resident or farmer asks one thing. Is smoke heading for my place? Choose a town and get one answer, in English, Spanish or Portuguese.',
  'The same pages work in Bolivia, Argentina and Brazil. Brazil is the heavy one. Here are its power lines with a fire upwind.',
  'A real test. On the eighth of January 2025, a five hundred kilovolt line in Paraguay tripped because of smoke. Replaying the archive, satellites saw fires nearby before the trip, and the modelled smoke crosses a line in two places. It does not show which fire caused it, and it gave no same day warning.',
  'Fires are observed. Assets are mapped. Wind is modelled. Smoke is a scenario. No detection does not mean no fire. That is Fireverse.',
];
const dur = SAY.map((t, i) => { const f = path.join(TMP, `s${i}.aiff`); execFileSync('say', ['-v', VOICE, '-r', '178', '-o', f, t]);
  return +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString() + 1.1; });
dur[4] = Math.max(dur[4], 14); dur[5] = Math.max(dur[5], 13);
console.log('scene seconds:', dur.map(d => d.toFixed(1)).join(' '), 'total', dur.reduce((a, b) => a + b, 0).toFixed(1));

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
await ctx.addInitScript(() => { try { if (location.protocol === 'http:') { localStorage.setItem('theme', 'light'); localStorage.setItem('fv.role.lang', JSON.stringify('en')); } } catch (e) { /* file page */ } });
const page = await ctx.newPage();
await page.goto('file://' + path.join(HERE, 'stage.html'));
const app = () => page.frames().find(f => f.url().startsWith(BASE)) || page.frames()[1];
const go = async (u, readySel) => { await page.evaluate(u => { document.getElementById('app').src = u; }, BASE + '/' + u); await sleep(300); await app().waitForSelector(readySel, { timeout: 60000 }); };
const scene = (n, head, url) => page.evaluate(([n, h, u]) => window.scene(n, h, u), [n, head, url]);
const tile = (...a) => page.evaluate(a => window.tile(...a), a);
async function click(sel, opts = {}) { // moves the drawn pointer first, so the viewer sees where the tap lands. The app sits in a scaled frame, so the tap is sent to the element itself.
  const loc = app().locator(sel).first(); await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.evaluate(e => e.scrollIntoView({ block: 'nearest' })); await sleep(120);
  const r = await loc.evaluate(e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const fr = await page.locator('#app').evaluate(e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y }; });
  const x = fr.x + (r.x + r.w * (opts.fx ?? .5)) * 1.2, y = fr.y + (r.y + Math.min(r.h * .5, 50)) * 1.2;
  await page.evaluate(([x, y]) => window.cur(x, y), [x, y]); await sleep(800); await page.evaluate(([x, y]) => window.cur(x, y, true), [x, y]);
  await loc.evaluate(e => { if (e.focus) e.focus(); e.click(); }); await sleep(opts.after ?? 500);
}
const text = sel => app().locator(sel).first().innerText();
const firstNum = s => (s.match(/[\d,]+/) || ['?'])[0];

/* warm up: wind for both regions is fetched once and cached by the server, so the recording does not wait on it */
for (const u of ['role.html?role=grid&r=BR', 'role.html?role=grid&r=PY']) { await go(u, '#work .rcard, #work .rl-note'); }
await app().evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await go('start.html', '#dealBtn');

const frames = []; const cdp = await ctx.newCDPSession(page);
cdp.on('Page.screencastFrame', f => { frames.push([f.metadata.timestamp, Buffer.from(f.data, 'base64')]); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });

const scenes = [
  async () => { await scene(1, 'What is the smoke <em>about to cross?</em>', 'fireverse / start'); await sleep(900); await tile('4', 'countries: Paraguay, Bolivia, Argentina, Brazil', 'mapped', 'map', 'blue'); await sleep(1200); await tile('3', 'languages: English, Spanish, Portuguese', '', '', 'orange'); },
  async () => { await scene(2, 'Pick your <em>role</em>', 'fireverse / start'); await click('#dealBtn', { after: 2200 }); await tile('6', 'roles in the deck', '', '', 'orange'); await sleep(1500); await tile('5', 'get a simplified page', '', '', 'blue'); },
  async () => { await scene(3, 'Grid operator: <em>one list</em>', 'fireverse / grid operator · Paraguay'); await click('a.card[data-role=grid]', { after: 300 }); await app().waitForSelector('#work .rcard', { timeout: 60000 }); await sleep(600);
    const s = await text('#work'); const m = s.match(/([\d,]+) power lines? with modelled smoke[^.]*?from ([\d,]+) fire/);
    await tile(m ? m[1] : firstNum(s), 'power lines with a fire upwind', 'scenario', 'scn', 'orange'); await sleep(1300); await tile(m ? m[2] : '?', 'fires of 5 MW or more, last 24 hours of data', 'observed', 'obs', 'green'); },
  async () => { await scene(4, 'Flip a card, <em>get a bulletin</em>', 'fireverse / grid operator · Paraguay'); await click('#work .rcard .rc-flip', { after: 2600 }); await click('#work .rcard[data-face=back] [data-fmt=short]', { after: 900 });
    const c = await text('#work .rcard[data-face=back] [data-k=count]').catch(() => ''); await tile(firstNum(c), 'characters, of 160 allowed in one text message', '', '', 'blue'); await sleep(1500); await click('#work .rcard[data-face=back] [data-act=copy]'); },
  async () => { await scene(5, 'Shift briefing: <em>three real steps</em>', 'fireverse / grid operator · Paraguay'); await app().evaluate(() => document.querySelector('#clockCard').scrollIntoView({ block: 'start' })); await click('#clockBtn', { after: 900 });
    for (let i = 0; i < 2; i++) { const more = app().locator('#work .rcard[data-face=front] .rc-flip'); if (await more.count()) await click('#work .rcard[data-face=front] .rc-flip', { after: 1100 }); }
    await app().evaluate(() => document.querySelector('#briefCard').scrollIntoView({ block: 'center', behavior: 'smooth' })); await sleep(900);
    await tile(await app().locator('#ringTxt').evaluate(e => e.textContent.trim()), 'steps done, counted from your own taps', 'your actions', 'you', 'green'); },
  async () => { await scene(6, 'Resident: <em>is smoke heading here?</em>', 'fireverse / resident · Paraguay'); await go('role.html?role=resident&r=PY', '#pickQ'); await click('#pickQ', { after: 200 }); await app().locator('#pickQ').pressSequentially('Concep', { delay: 110 }); await sleep(600);
    await click('#pickList button.rl-match', { after: 300 }); await app().waitForSelector('#work .rcard', { timeout: 30000 }).catch(() => {}); await sleep(1800);
    await tile('1', 'place, one plain answer', 'scenario', 'scn', 'orange'); await sleep(800); await click('#langBox [data-lang=es]', { after: 1600 }); await click('#langBox [data-lang=pt]', { after: 1400 }); await click('#langBox [data-lang=en]'); },
  async () => { await scene(7, 'Same page, <em>four countries</em>', 'fireverse / grid operator · Brazil'); await go('role.html?role=grid&r=BR', '#work .rcard, #work .rl-note'); await sleep(500);
    const s = await text('#work'); const m = s.match(/([\d,]+) power lines? with modelled smoke[^.]*?from ([\d,]+) fire/);
    await tile(m ? m[1] : '?', 'power lines in Brazil with a fire upwind', 'scenario', 'scn', 'orange'); await sleep(1200); await tile(m ? Number(m[2].replace(/,/g, '')).toLocaleString('en-US') : '?', 'fires of 5 MW or more, last 24 hours of data', 'observed', 'obs', 'green'); },
  async () => { await scene(8, 'Replay: <em>a real line trip</em>', 'fireverse / downwind · replay 8 Jan 2025'); await go('downwind.html?r=PY', '[data-mode=replay]'); await sleep(1200); await click('[data-mode=replay]', { after: 300 }); await app().waitForSelector('#dwReplay:not([hidden]) .dw-rp-grid', { timeout: 60000 }); await sleep(800);
    const s = await text('#dwReplay'); const m = s.match(/(\d+) fire clusters/);
    await tile(m ? m[1] : '?', 'fire clusters near the park in the 12 hours before', 'observed', 'obs', 'green'); await sleep(2500); await tile('2', 'places where modelled smoke crosses a 500 kV line', 'scenario', 'scn', 'orange'); await sleep(4000);
    await tile('0', 'minutes of same-day warning', 'limit', 'you', 'blue'); await app().evaluate(() => document.querySelector('#dwReplay').scrollIntoView({ block: 'start', behavior: 'smooth' })); },
  async () => { await scene(9, 'Labelled, <em>every time</em>', 'fireverse / start'); await app().evaluate(() => localStorage.removeItem('fv.role')); await go('start.html', '#dealBtn'); await tile('Fires', 'seen by satellite', 'observed', 'obs', 'green'); await sleep(1100); await tile('Assets', 'from OpenStreetMap', 'mapped', 'map', 'blue'); await sleep(1100); await tile('Wind', 'from a weather model', 'modelled', 'mod', 'blue'); await sleep(1100); await tile('Smoke', 'a what-if, not a measurement', 'scenario', 'scn', 'orange'); await click('#dealBtn', { after: 1500 }); },
];

await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 93, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await sleep(400); const T0 = Date.now() / 1000; let at = T0; const late = [];
for (let i = 0; i < scenes.length; i++) {
  try { await scenes[i](); } catch (e) { console.log(`scene ${i + 1} problem: ${e.message.split('\n')[0]}`); }
  at += dur[i]; const left = at - Date.now() / 1000; if (left < 0) { late.push(`scene ${i + 1} ran ${(-left).toFixed(1)} s over`); dur[i] -= left; at -= left; } else await sleep(left * 1000);
}
const TEND = Date.now() / 1000; await cdp.send('Page.stopScreencast'); await browser.close();
if (late.length) console.log(late.join('; '));

/* frames -> video: each frame is held until the next one arrives */
const use = frames.filter(f => f[0] <= TEND); let start = use.findIndex(f => f[0] >= T0); if (start > 0) start--; const fr = use.slice(Math.max(0, start));
let list = 'ffconcat version 1.0\n';
fr.forEach(([ts, buf], i) => { const f = path.join(TMP, `f${String(i).padStart(5, '0')}.jpg`); fs.writeFileSync(f, buf); const t0 = Math.max(ts, T0), t1 = i + 1 < fr.length ? fr[i + 1][0] : TEND; list += `file '${f}'\nduration ${Math.max(.001, t1 - t0).toFixed(4)}\n`; });
list += `file '${path.join(TMP, `f${String(fr.length - 1).padStart(5, '0')}.jpg`)}'\n`; fs.writeFileSync(path.join(TMP, 'frames.txt'), list);
let alist = ''; dur.forEach((d, i) => { const f = path.join(TMP, `a${i}.wav`); execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(TMP, `s${i}.aiff`), '-af', 'adelay=350:all=1,apad', '-t', d.toFixed(3), '-ar', '44100', '-ac', '2', f]); alist += `file '${f}'\n`; });
fs.writeFileSync(path.join(TMP, 'audio.txt'), alist);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(TMP, 'frames.txt'), '-f', 'concat', '-safe', '0', '-i', path.join(TMP, 'audio.txt'),
  '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', OUT]);
console.log(`${fr.length} frames, ${(TEND - T0).toFixed(1)} s -> ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
fs.rmSync(TMP, { recursive: true, force: true });
