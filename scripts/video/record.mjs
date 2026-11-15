/* Records the FIREVERSE walkthrough: a stage page (stage.html) with the live app inside, driven by Playwright,
   narrated with the edge-tts neural voice (scripts/video/tts.py; needs network), captioned from the voice's own word
   timings, encoded by ffmpeg. Every number on the tiles is read from the app while recording; story characters and the
   navigation idea are labelled as such on screen.
   Needs the server on 127.0.0.1:8000.   usage: node scripts/video/record.mjs [out.mp4]   (FV_VOICE, FV_RATE to change the voice) */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import crypto from 'node:crypto'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..'), BASE = 'http://127.0.0.1:8000';
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'docs/video/fireverse-roles-walkthrough.mp4'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-video-')), VOICE = process.env.FV_VOICE || 'en-US-AndrewNeural', RATE = process.env.FV_RATE || '+0%';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VCACHE = path.join(ROOT, 'data/cache/voice'); fs.mkdirSync(VCACHE, { recursive: true });
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const LEAD = .35; // the voice starts this long after each scene starts

/* The story: one character per job, the smoke at the centre. Numbers are written as words so the captions line up. */
const SAY = [
  "Suppose you're Ana. You run a fire brigade in Paraguay. It's a hot afternoon, and a satellite has just spotted a fire outside town. But here's the thing: the fire isn't your only problem. The smoke is. Where is it going? Who's about to breathe it? What's about to go dark?",
  "And Ana isn't alone. Meet the crew. Diego keeps the power grid running. Marco patrols the highway. Lucía runs a rural clinic. And Rosa farms just outside town. Each of them gets a card. Tap one, and you get a page built for that job.",
  "So let's start with Ana. She sets her base, and instantly she sees every fire within fifty kilometres, strongest first. For each one: which way the wind is pushing the smoke, and what's sitting right in its path.",
  "Wait. How do we actually know where the smoke goes? This is FIRELAB. We take the fire's real power, measured from space. We take the wind at that hour, from a weather model. Then we grow the smoke plume, hour by hour. Watch it drift. Every step is a separate model run, so we call it what it is: a scenario, not a measurement.",
  "Now, Diego. Here's something most people don't know. Thick smoke between high voltage wires can make a power line trip, and a whole city goes dark. So Diego gets one list: power lines with a fire upwind.",
  "He taps a card, and it flips into a ready made bulletin. Copy it. Read it out on the radio. Or send it on WhatsApp. There's even a short version that fits in one text message, for crews with just one bar of signal.",
  "And to make it a daily habit, there's a three step shift briefing. Check the satellite clock. Review the top items. Send a bulletin. The ring only fills with things you actually did. No fake points. No badges.",
  "Rosa, the farmer, has one question. Is smoke heading for my place? She types her town, and gets one plain answer. In English, Spanish or Portuguese.",
  "Zoom out, and everyone's view comes from one watch list. Power lines, roads, clinics, schools. It even flags fires that are close but not downwind, because a simple distance circle would cry wolf. And for the impatient, there's a fast look, from a satellite that checks in every ten minutes.",
  "OK, but does any of this hold up in real life? January eighth, twenty twenty five. A five hundred kilovolt line trips in Paraguay, and the utility blames smoke. We replayed the satellite archive. Fires were spotted near the line hours before. And the modelled smoke crosses a high voltage line in two places. Honest caveat: it can't tell us which fire did it, and it gave no warning that same day.",
  "Now here's where it gets really big. Think about Marco on the highway. Map apps today show you the air quality right now. But smoke moves. What if your navigation could see where the smoke will be in an hour, and route you around it? This engine could plug into the map apps millions of people already use, like Google Maps. We haven't built that part yet. But every piece it needs, you've just seen.",
  "So that's Fireverse. Four countries, three languages, and one big question: what is the smoke about to cross? Fires are observed. Assets are mapped. Wind is modelled. Smoke is a scenario. And remember, no detection doesn't mean no fire. Stay safe out there.",
];
/* voice + captions: phrases break at punctuation or after seven words; each starts at its first word's spoken time */
const CAPS = [], dur = SAY.map((t, i) => {
  const tf = path.join(TMP, `t${i}.txt`), mp3 = path.join(TMP, `s${i}.mp3`), wj = path.join(TMP, `w${i}.json`); fs.writeFileSync(tf, t);
  // voiced lines are kept in data/cache/voice (git-ignored), so a re-record asks the voice service only for changed lines
  const key = crypto.createHash('sha1').update(VOICE + '|' + RATE + '|' + t).digest('hex').slice(0, 16), cm = path.join(VCACHE, key + '.mp3'), cj = path.join(VCACHE, key + '.json');
  if (fs.existsSync(cm) && fs.statSync(cm).size > 0 && fs.existsSync(cj)) { fs.copyFileSync(cm, mp3); fs.copyFileSync(cj, wj); }
  else for (let k = 1; ; k++) { // the free service throttles bursts: it answers with no audio until it has had about 40 s of rest
    try { execFileSync('python3', [path.join(HERE, 'tts.py'), tf, mp3, wj, VOICE, RATE], { stdio: 'pipe' }); if (!fs.statSync(mp3).size) throw new Error('empty audio'); fs.copyFileSync(mp3, cm); fs.copyFileSync(wj, cj); pause(6000); break; }
    catch (e) { if (k >= 6) throw new Error(`voice failed for line ${i + 1}: ${String(e.stderr || e.message).trim().split('\n').pop()}`); console.log(`line ${i + 1}: voice service busy, waiting ${20 * k} s`); pause(20000 * k); }
  }
  const W = JSON.parse(fs.readFileSync(wj, 'utf8')).words, toks = t.split(/\s+/).filter(Boolean), phrases = [];
  let cur = [];
  toks.forEach((w, k) => { cur.push(k); if (/[,.:;?!]$/.test(w) || cur.length >= 7) { phrases.push(cur); cur = []; } }); if (cur.length) phrases.push(cur);
  const at = k => W[Math.min(W.length - 1, Math.round(k * W.length / toks.length))];
  CAPS.push(phrases.map(ks => ({ t: LEAD + at(ks[0]).start, end: LEAD + at(ks[ks.length - 1]).end, text: ks.map(k => toks[k]).join(' ') })));
  return +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).toString() + LEAD + .7;
});
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

/* warm up: wind is fetched once and cached by the server, so the recording does not wait on it */
for (const u of ['role.html?role=grid&r=PY', 'role.html?role=road&r=PY']) { await go(u, '#work .rcard, #work .rl-note'); }
await app().evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
const firelab = async () => { await go('firelab.html', '#simPlay'); await sleep(1500); await app().evaluate(() => { const c = document.getElementById('simHowClose'); if (c && c.offsetParent) c.click(); }); await sleep(1500); };
await firelab(); // the story opens on the smoke

const frames = []; const cdp = await ctx.newCDPSession(page);
cdp.on('Page.screencastFrame', f => { frames.push([f.metadata.timestamp, Buffer.from(f.data, 'base64')]); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
const numOf = s => (String(s).match(/\d[\d,.]*/) || ['?'])[0].replace(/[.,]$/, '');
const statsOf = async () => app().locator('.rl-stat b').allInnerTexts().catch(() => []);

const scenes = [
  async () => { await scene(1, "Suppose you're <em>a fire brigade</em>", 'fireverse / firelab'); await tile('Ana', 'fire brigade captain, Paraguay', 'story character', 'you', 'orange'); await sleep(4200);
    await click('#simPlay', { after: 300 }); await tile('Fire', 'spotted by satellite, with its real power', 'observed', 'obs', 'green'); await sleep(5000); await tile('Smoke', 'where is it going?', 'scenario', 'scn', 'orange'); },
  async () => { await scene(2, 'Meet <em>the crew</em>', 'fireverse / start'); await go('start.html', '#dealBtn'); await sleep(600); await click('#dealBtn', { after: 1500 });
    for (const [n, job, c] of [['Diego', 'keeps the power grid running', 'blue'], ['Marco', 'patrols the highway', 'orange'], ['Lucía', 'runs a rural clinic', 'green'], ['Rosa', 'farms just outside town', 'blue']]) { await tile(n, job, 'story character', 'you', c); await sleep(1700); } },
  async () => { await scene(3, 'Ana: <em>fires near base</em>', 'fireverse / fire brigade · Paraguay'); await go('role.html?role=firefighter&r=PY', '#pickQ'); await click('#pickQ', { after: 200 });
    await app().locator('#pickQ').pressSequentially('Puerto Cas', { delay: 90 }); await sleep(500); await click('#pickList button.rl-match', { after: 300 });
    await app().waitForSelector('.rl-stat', { timeout: 30000 }).catch(() => {}); await sleep(900); const st = await statsOf();
    await tile(numOf(st[0]), 'fires within 50 km of base, last 24 h of data', 'observed', 'obs', 'green'); await sleep(2500); await click('#work .rcard .rc-flip', { after: 800 }); },
  async () => { await scene(4, 'Where does <em>the smoke go?</em>', 'fireverse / firelab'); await firelab();
    const fire = await app().locator('#simFire option:checked').textContent().catch(() => ''); const ws = (await app().locator('#simHudSpeed').textContent().catch(() => '')).match(/[\d.]+/);
    await tile(numOf((fire.match(/[\d.]+ MW/) || ['?'])[0]), 'MW fire power, measured from space', 'observed', 'obs', 'green'); await sleep(2600);
    await tile(ws ? ws[0] : '?', 'm/s wind at that hour, from a weather model', 'modelled', 'mod', 'blue'); await sleep(2200); await click('#simPlay', { after: 300 }); await sleep(4500);
    const hrs = await text('#simHoursV').catch(() => ''); const pk = await app().locator('text=Peak added at ground').first().locator('xpath=..').innerText().catch(() => '');
    await tile(numOf(hrs) + ' h', 'of smoke so far, one model run per hour', 'scenario', 'scn', 'orange'); await sleep(1500); await tile(numOf(pk), 'µg/m³ peak added at ground', 'scenario', 'scn', 'blue'); },
  async () => { await scene(5, 'Diego: <em>lines at risk</em>', 'fireverse / grid operator · Paraguay'); await go('role.html?role=grid&r=PY', '#work .rcard, #work .rl-note'); await sleep(800); const st = await statsOf();
    await tile('Diego', 'power grid operator', 'story character', 'you', 'blue'); await sleep(3500); await tile(numOf(st[0]), 'power lines with a fire upwind', 'scenario', 'scn', 'orange'); await sleep(1500); await tile(numOf(st[1]), 'fires of 5 MW or more, last 24 h of data', 'observed', 'obs', 'green'); },
  async () => { await scene(6, 'Flip a card, <em>send a bulletin</em>', 'fireverse / grid operator · Paraguay'); await click('#work .rcard .rc-flip', { after: 2600 }); await click('#work .rcard[data-face=back] [data-fmt=short]', { after: 900 });
    const c = await text('#work .rcard[data-face=back] [data-k=count]').catch(() => ''); await tile(numOf(c), 'characters, of 160 allowed in one text message', '', '', 'blue'); await sleep(1800); await click('#work .rcard[data-face=back] [data-act=copy]'); },
  async () => { await scene(7, 'Shift briefing: <em>three real steps</em>', 'fireverse / grid operator · Paraguay'); await app().evaluate(() => document.querySelector('#clockCard').scrollIntoView({ block: 'start' })); await click('#clockBtn', { after: 900 });
    for (let i = 0; i < 2; i++) { const more = app().locator('#work .rcard[data-face=front] .rc-flip'); if (await more.count()) await click('#work .rcard[data-face=front] .rc-flip', { after: 1100 }); }
    await app().evaluate(() => document.querySelector('#briefCard').scrollIntoView({ block: 'center', behavior: 'smooth' })); await sleep(900);
    await tile(await app().locator('#ringTxt').evaluate(e => e.textContent.trim()), 'steps done, counted from your own taps', 'your actions', 'you', 'green'); },
  async () => { await scene(8, 'Rosa: <em>is smoke heading here?</em>', 'fireverse / resident · Paraguay'); await go('role.html?role=resident&r=PY', '#pickQ'); await tile('Rosa', 'farmer, just outside town', 'story character', 'you', 'blue');
    await click('#pickQ', { after: 200 }); await app().locator('#pickQ').pressSequentially('Concep', { delay: 110 }); await sleep(600);
    await click('#pickList button.rl-match', { after: 300 }); await app().waitForSelector('#work .rcard', { timeout: 30000 }).catch(() => {}); await sleep(1500);
    await tile('1', 'place, one plain answer', 'scenario', 'scn', 'orange'); await sleep(600); await click('#langBox [data-lang=es]', { after: 1400 }); await click('#langBox [data-lang=pt]', { after: 1300 }); await click('#langBox [data-lang=en]'); },
  async () => { await scene(9, 'One <em>watch list</em>', 'fireverse / downwind · Paraguay'); await go('downwind.html?r=PY', '[data-kind=power]'); await sleep(1200); await click('[data-kind=roads]', { after: 1500 }); await click('[data-kind=power]', { after: 1200 });
    const n = await app().locator('#nPower').textContent().catch(() => '?'); await tile(n || '?', 'power lines with smoke reaching them, last 24 h', 'scenario', 'scn', 'orange'); await sleep(3500); await click('[data-mode=fast]', { after: 2200 });
    await tile('10 min', 'fast look: coarse pixels, labelled as such', 'fast', 'fast', 'blue'); await sleep(1600); await click('[data-mode=live]', { after: 600 }); },
  async () => { await scene(10, 'Real test: <em>a line trip</em>', 'fireverse / downwind · replay 8 Jan 2025'); await click('[data-mode=replay]', { after: 300 }); await app().waitForSelector('#dwReplay:not([hidden]) .dw-rp-grid', { timeout: 60000 }); await sleep(800);
    const s = await text('#dwReplay'); const m = s.match(/(\d+) fire clusters/);
    await tile(m ? m[1] : '?', 'fire clusters near the park in the 12 hours before', 'observed', 'obs', 'green'); await sleep(5000); await tile('2', 'places where modelled smoke crosses a 500 kV line', 'scenario', 'scn', 'orange'); await sleep(5000);
    await tile('0', 'minutes of same-day warning', 'limit', 'you', 'blue'); await app().evaluate(() => document.querySelector('#dwReplay').scrollIntoView({ block: 'start', behavior: 'smooth' })); },
  async () => { await scene(11, 'Next: <em>smoke-aware navigation</em>', 'fireverse / downwind · roads · Paraguay'); await click('[data-mode=live]', { after: 1200 }); await click('[data-kind=roads]', { after: 300 });
    await app().waitForFunction(() => (document.getElementById('nRoads').textContent || '').trim() !== '', null, { timeout: 20000 }).catch(() => {});
    await tile('Marco', 'highway patrol', 'story character', 'you', 'orange'); await sleep(2500);
    const n = await app().locator('#nRoads').textContent().catch(() => '?'); await tile(n || '?', 'main roads with modelled smoke crossing them, last 24 h', 'scenario', 'scn', 'orange'); await sleep(3500);
    await tile('Now', 'map apps show the air quality right now', '', '', 'blue'); await sleep(3500); await tile('Next', 'smoke ahead on your route, an hour from now', 'idea, not built yet', 'you', 'green');
    await click('#dwRows > *', { after: 600 }).catch(() => {}); },
  async () => { await scene(12, 'What is the smoke <em>about to cross?</em>', 'fireverse / start'); await app().evaluate(() => localStorage.removeItem('fv.role')); await go('start.html', '#dealBtn');
    await tile('Fires', 'seen by satellite', 'observed', 'obs', 'green'); await sleep(2600); await tile('Assets', 'from OpenStreetMap', 'mapped', 'map', 'blue'); await sleep(900); await tile('Wind', 'from a weather model', 'modelled', 'mod', 'blue'); await sleep(900); await tile('Smoke', 'a what-if, not a measurement', 'scenario', 'scn', 'orange'); await click('#dealBtn', { after: 1500 }); },
];

await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 93, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await sleep(400); const T0 = Date.now() / 1000; let at = T0; const late = [];
for (let i = 0; i < scenes.length; i++) {
  await page.evaluate(c => window.captions(c), CAPS[i]);
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
let alist = ''; dur.forEach((d, i) => { const f = path.join(TMP, `a${i}.wav`); execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(TMP, `s${i}.mp3`), '-af', `adelay=${LEAD * 1000}:all=1,apad`, '-t', d.toFixed(3), '-ar', '44100', '-ac', '2', f]); alist += `file '${f}'\n`; });
fs.writeFileSync(path.join(TMP, 'audio.txt'), alist);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(TMP, 'frames.txt'), '-f', 'concat', '-safe', '0', '-i', path.join(TMP, 'audio.txt'),
  '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', OUT]);
console.log(`${fr.length} frames, ${(TEND - T0).toFixed(1)} s -> ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
fs.rmSync(TMP, { recursive: true, force: true });
