/* Records the FIREVERSE walkthrough: a stage page (stage.html) with the live app inside, driven by Playwright.
   Six story characters, one per role, each with an avatar and their own edge-tts neural voice (scripts/video/tts.py; needs
   network), show the pages they use; a narrator opens and closes. Captions and mouth movement follow the voice's own word
   timings. Every number on the tiles is read from the app while recording; the characters are labelled as story characters.
   Needs the server on 127.0.0.1:8000.   usage: node scripts/video/record.mjs [out.mp4] */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import crypto from 'node:crypto'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..'), BASE = 'http://127.0.0.1:8000';
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'docs/video/fireverse-roles-walkthrough.mp4'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-video-')), RATE = process.env.FV_RATE || '+0%';
const VCACHE = path.join(ROOT, 'data/cache/voice'); fs.mkdirSync(VCACHE, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const LEAD = .35; // each scene's voice starts this long after the scene starts
const VOICES = { narrator: 'en-US-AndrewNeural', ana: 'en-US-EmmaNeural', diego: 'en-US-BrianNeural', marco: 'en-GB-RyanNeural', lucia: 'en-US-AvaNeural', rosa: 'en-AU-NatashaNeural', arjun: 'en-IN-PrabhatNeural' };

/* one line per scene; numbers as words so the captions line up */
const SAY = [
  ['narrator', "One fire. One plume of smoke. And six people who all need to know the same thing: where is that smoke going? Let's meet them, and let them show you how they use Fireverse."],
  ['narrator', "Ana runs a fire brigade. Diego keeps the power grid running. Marco patrols the highway. Lucía runs a rural clinic. Rosa farms just outside town. And Arjun is the analyst, who wants every number. Six people, six cards. Each card opens a page built for that job."],
  ['ana', "Hi, I'm Ana. I run the fire brigade. First thing on my shift, I set my base. And there it is: every fire within fifty kilometres, strongest first."],
  ['ana', "I tap a fire, and the card flips over. Which way the wind is pushing the smoke, and what's sitting in its path. The short version fits in one text message, so my crew gets it even on one bar of signal."],
  ['diego', "I'm Diego. I keep the lights on. Here's something most people don't know: thick smoke between high voltage wires can trip a power line, and a whole city goes dark. So my page shows one thing first: power lines with a fire upwind."],
  ['diego', "Every shift, I run a three step briefing. Check when the satellites last looked. Review the top lines. Send a bulletin to my crews. The ring only fills with things I actually did. No points, no badges. Just the job."],
  ['marco', "Marco here, highway patrol. My page shows the stretches of road the smoke could cross, and I can read the bulletin out loud, straight over the radio."],
  ['marco', "And this is my favourite part: a smoke aware route planner. I pick where I'm going, and it checks each route against where the smoke will be when I drive through. Not just the air quality right now. One tap, and the safer route opens in Google Maps."],
  ['lucia', "I'm Lucía. I run a small clinic. I need one answer: is smoke heading for my clinic? I pick my site, and I get it in plain words. Then I share it with my staff on WhatsApp."],
  ['rosa', "Hola! I'm Rosa. I farm just outside town. I type my town, and the answer is right there. In English, Spanish, or Portuguese."],
  ['arjun', "I'm Arjun, the analyst. I want every number. Two kinds of satellites, MODIS and VIIRS, see the same fires differently. Fireverse merges them, so each fire is counted once."],
  ['arjun', "In the harmonization lab, I can check how detections were matched across satellites. And on the map, every dot is a real NASA detection. Nothing is made up."],
  ['arjun', "But the heart of it is the smoke. In FIRELAB, I take a fire's real power, measured from space, and the wind from a weather model, and grow the plume hour by hour. It's a scenario, not a measurement, and we always label it that way."],
  ['arjun', "Everyone's page comes from this one watch list. Power lines, roads, clinics, schools. It even flags fires that are close but not downwind, so a simple distance circle doesn't cry wolf. And there's a fast look, from a satellite that checks in every ten minutes."],
  ['diego', "But does it work in real life? January eighth, twenty twenty five. A five hundred kilovolt line tripped in Paraguay, and the utility blamed smoke. We replayed the satellite archive. Fires were spotted near the line hours before, and the modelled smoke crosses a high voltage line in two places. Honest caveat: it can't say which fire did it, and it gave no warning that same day."],
  ['marco', "Now picture this inside the map apps millions of people already use. Not just today's air quality, but the smoke ahead on your route. Every route comes with a smoke file a map app could read. Plugging it into the big map apps is the next step."],
  ['narrator', "Six people. One question. What is the smoke about to cross? Fires are observed. Assets are mapped. Wind is modelled. Smoke is a scenario. And remember: no detection doesn't mean no fire. Stay safe out there."],
];

/* voice + captions: lines are cached in data/cache/voice (git-ignored); phrases break at punctuation or after seven words */
const CAPS = [], WORDS = [], dur = SAY.map(([who, t], i) => {
  const voice = VOICES[who], tf = path.join(TMP, `t${i}.txt`), mp3 = path.join(TMP, `s${i}.mp3`), wj = path.join(TMP, `w${i}.json`); fs.writeFileSync(tf, t);
  const key = crypto.createHash('sha1').update(voice + '|' + RATE + '|' + t).digest('hex').slice(0, 16), cm = path.join(VCACHE, key + '.mp3'), cj = path.join(VCACHE, key + '.json');
  if (fs.existsSync(cm) && fs.statSync(cm).size > 0 && fs.existsSync(cj)) { fs.copyFileSync(cm, mp3); fs.copyFileSync(cj, wj); }
  else for (let k = 1; ; k++) { // the free service throttles bursts: it answers with no audio until it has had about 40 s of rest
    try { execFileSync('python3', [path.join(HERE, 'tts.py'), tf, mp3, wj, voice, RATE], { stdio: 'pipe' }); if (!fs.statSync(mp3).size) throw new Error('empty audio'); fs.copyFileSync(mp3, cm); fs.copyFileSync(wj, cj); pause(6000); break; }
    catch (e) { if (k >= 6) throw new Error(`voice failed for line ${i + 1}: ${String(e.stderr || e.message).trim().split('\n').pop()}`); console.log(`line ${i + 1}: voice service busy, waiting ${20 * k} s`); pause(20000 * k); }
  }
  const W = JSON.parse(fs.readFileSync(wj, 'utf8')).words, toks = t.split(/\s+/).filter(Boolean), phrases = [];
  let cur = [];
  toks.forEach((w, k) => { cur.push(k); if (/[,.:;?!]$/.test(w) || cur.length >= 7) { phrases.push(cur); cur = []; } }); if (cur.length) phrases.push(cur);
  const at = k => W[Math.min(W.length - 1, Math.round(k * W.length / toks.length))];
  CAPS.push(phrases.map(ks => ({ t: LEAD + at(ks[0]).start, end: LEAD + at(ks[ks.length - 1]).end, text: ks.map(k => toks[k]).join(' ') })));
  WORDS.push(W);
  return +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).toString() + LEAD + .8;
});
console.log('scene seconds:', dur.map(d => d.toFixed(1)).join(' '), 'total', dur.reduce((a, b) => a + b, 0).toFixed(1));
if (process.env.FV_VOICE_ONLY) process.exit(0);

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
async function where(sel, fx = .5) { // the element's spot on the stage: the app sits in a frame scaled by 1.2
  const loc = app().locator(sel).first(); await loc.waitFor({ state: 'visible', timeout: 15000 });
  await loc.evaluate(e => e.scrollIntoView({ block: 'nearest' })); await sleep(120);
  const r = await loc.evaluate(e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const fr = await page.locator('#app').evaluate(e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y }; });
  return { loc, x: fr.x + (r.x + r.w * fx) * 1.2, y: fr.y + (r.y + Math.min(r.h * .5, 50)) * 1.2 };
}
async function point(sel, opts = {}) { const p = await where(sel, opts.fx); await page.evaluate(([x, y]) => window.cur(x, y), [p.x, p.y]); await sleep(opts.after ?? 900); }
async function click(sel, opts = {}) { // the drawn pointer moves first, so the viewer sees where the tap lands; the tap is sent to the element itself
  const p = await where(sel, opts.fx);
  await page.evaluate(([x, y]) => window.cur(x, y), [p.x, p.y]); await sleep(800); await page.evaluate(([x, y]) => window.cur(x, y, true), [p.x, p.y]);
  await p.loc.evaluate(e => { if (e.focus) e.focus(); e.click(); }); await sleep(opts.after ?? 500);
}
const text = sel => app().locator(sel).first().innerText();
const numOf = s => (String(s).match(/\d[\d,.]*/) || ['?'])[0].replace(/[.,]$/, '');
const statsOf = async () => app().locator('.rl-stat b').allInnerTexts().catch(() => []);
async function numNear(label) { // the number in the card that carries this label
  for (const up of ['xpath=..', 'xpath=../..']) { const t = await app().locator(`text=${label}`).first().locator(up).innerText().catch(() => ''); const n = numOf(t.replace(label, '')); if (n !== '?') return n; }
  return '?';
}
const firelab = async () => { await go('firelab.html', '#simPlay'); await sleep(1500); await app().evaluate(() => { const c = document.getElementById('simHowClose'); if (c && c.offsetParent) c.click(); }); await sleep(1500); };

/* warm up: wind and routes are fetched once and cached by the server, so the recording does not wait on them */
for (const u of ['role.html?role=grid&r=PY', 'role.html?role=road&r=PY']) { await go(u, '#work .rcard, #work .rl-note'); }
await go('route.html?r=PY', '#rtExample').then(async () => { await app().locator('#rtExample').click(); await app().waitForSelector('#rtRoutes .rt-route', { timeout: 90000 }); }).catch(e => console.log('route warm-up:', e.message.split('\n')[0]));
await go('index.html', '[data-page=harmonization]').catch(() => {}); await sleep(4000);
await app().evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.evaluate(n => window.setTotal(n), SAY.length);
await firelab(); // the story opens on the smoke

const frames = []; const cdp = await ctx.newCDPSession(page);
cdp.on('Page.screencastFrame', f => { frames.push([f.metadata.timestamp, Buffer.from(f.data, 'base64')]); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });

const scenes = [
  async () => { await scene(1, 'One fire. <em>One plume.</em>', 'fireverse / firelab'); await sleep(1200); await click('#simPlay', { after: 300 }); await tile('Fire', 'spotted by satellite, with its real power', 'observed', 'obs', 'green'); await sleep(4500); await tile('Smoke', 'where is it going?', 'scenario', 'scn', 'orange'); await sleep(3000); await tile('6', 'people who need to know', '', '', 'blue'); },
  async () => { await scene(2, 'Meet <em>the crew</em>', 'fireverse / start'); await page.evaluate(() => window.castLine(true)); await sleep(11500); await page.evaluate(() => window.castLine(false));
    await go('start.html', '#dealBtn'); await sleep(400); await click('#dealBtn', { after: 1800 }); await tile('6', 'roles in the deck', '', '', 'orange'); await tile('5', 'get a simplified page', '', '', 'blue'); },
  async () => { await scene(3, 'Ana: <em>fires near base</em>', 'fireverse / fire brigade · Paraguay'); await click('a.card[data-role=firefighter]', { after: 300 }); await app().waitForSelector('#pickQ', { timeout: 30000 });
    await click('#pickQ', { after: 200 }); await app().locator('#pickQ').pressSequentially('Puerto Cas', { delay: 90 }); await sleep(500); await click('#pickList button.rl-match', { after: 300 });
    await app().waitForSelector('.rl-stat', { timeout: 30000 }).catch(() => {}); await sleep(700); const st = await statsOf();
    await tile(numOf(st[0]), 'fires within 50 km of base, last 24 h of data', 'observed', 'obs', 'green'); await point('.rl-stat'); },
  async () => { await scene(4, 'Flip a fire, <em>get the smoke path</em>', 'fireverse / fire brigade · Paraguay'); await click('#work .rcard .rc-flip', { after: 2500 }); await point('#work .rcard[data-face=back] [data-k=facts]', { after: 1500 }).catch(() => {});
    await click('#work .rcard[data-face=back] [data-fmt=short]', { after: 900 }); const c = await text('#work .rcard[data-face=back] [data-k=count]').catch(() => '');
    await tile(numOf(c), 'characters, of 160 allowed in one text message', '', '', 'blue'); await sleep(1200); await click('#work .rcard[data-face=back] [data-act=copy]'); },
  async () => { await scene(5, 'Diego: <em>lines at risk</em>', 'fireverse / grid operator · Paraguay'); await go('role.html?role=grid&r=PY', '#work .rcard, #work .rl-note'); await sleep(900); const st = await statsOf();
    await sleep(4500); await tile(numOf(st[0]), 'power lines with a fire upwind', 'scenario', 'scn', 'orange'); await point('.rl-stat'); await tile(numOf(st[1]), 'fires of 5 MW or more, last 24 h of data', 'observed', 'obs', 'green'); },
  async () => { await scene(6, 'Shift briefing: <em>three real steps</em>', 'fireverse / grid operator · Paraguay'); await app().evaluate(() => document.querySelector('#clockCard').scrollIntoView({ block: 'start' })); await click('#clockBtn', { after: 1200 });
    for (let i = 0; i < 2; i++) { const more = app().locator('#work .rcard[data-face=front] .rc-flip'); if (await more.count()) await click('#work .rcard[data-face=front] .rc-flip', { after: 1200 }); }
    await click('#work .rcard[data-face=back] [data-act=copy]', { after: 600 }).catch(() => {});
    await app().evaluate(() => document.querySelector('#briefCard').scrollIntoView({ block: 'center', behavior: 'smooth' })); await sleep(900);
    await tile(await app().locator('#ringTxt').evaluate(e => e.textContent.trim()), 'steps done, counted from his own taps', 'his actions', 'you', 'green'); await point('#ringTxt'); },
  async () => { await scene(7, 'Marco: <em>roads in the smoke</em>', 'fireverse / road patrol · Paraguay'); await go('role.html?role=road&r=PY', '#work .rcard, #work .rl-note'); await sleep(900); const st = await statsOf();
    await tile(numOf(st[0]), 'stretches of main road the smoke could cross', 'scenario', 'scn', 'orange'); await point('.rl-stat'); await click('#work .rcard .rc-flip', { after: 1500 }); await click('#work .rcard[data-face=back] [data-act=speak]', { after: 2500 }).catch(() => {});
    await app().evaluate(() => { if ('speechSynthesis' in window) speechSynthesis.cancel(); }); },
  async () => { await scene(8, 'New: <em>a smoke-aware route</em>', 'fireverse / route planner · Paraguay'); await go('route.html?r=PY', '#rtExample'); await sleep(800); await click('#rtExample', { after: 400 });
    await app().waitForSelector('#rtRoutes .rt-route', { timeout: 90000 }); await sleep(1200);
    const n = await app().locator('#rtRoutes .rt-route').count(); await tile(String(n), 'driving routes checked against the smoke', 'scenario', 'scn', 'orange');
    await point('#rtBest', { after: 1800 }); const best = await app().locator('#rtRoutes .rt-route[data-best=true]').first().innerText().catch(() => '');
    const inSmoke = (best.match(/([\d.,]+)\s*km in (modelled )?smoke/i) || [])[1]; if (inSmoke) await tile(inSmoke + ' km', 'in modelled smoke on the best route', 'scenario', 'scn', 'green');
    await point('#rtRoutes .rt-route[data-best=true]', { after: 1500 }); await point('#rtGmaps', { after: 1200 }); await tile('Maps', 'open the safer route in Google Maps', '', '', 'blue'); },
  async () => { await scene(9, 'Lucía: <em>is smoke heading for my clinic?</em>', 'fireverse / clinic or school lead · Paraguay'); await go('role.html?role=care&r=PY', '#pickQ'); await sleep(600);
    await click('#pickQ', { after: 200 }); await app().locator('#pickQ').pressSequentially('Hospital', { delay: 90 }); await sleep(700); await click('#pickList button.rl-match', { after: 300 });
    await app().waitForSelector('#work .rcard', { timeout: 30000 }).catch(() => {}); await sleep(1200); await tile('1', 'site, one plain answer', 'scenario', 'scn', 'orange');
    await click('#work .rcard .rc-flip', { after: 1500 }).catch(() => {}); await point('#work [data-act=wa]', { after: 1200 }).catch(() => {}); await tile('Share', 'by WhatsApp, in one tap', '', '', 'green'); },
  async () => { await scene(10, 'Rosa: <em>is smoke heading here?</em>', 'fireverse / resident · Paraguay'); await go('role.html?role=resident&r=PY', '#pickQ');
    await click('#pickQ', { after: 200 }); await app().locator('#pickQ').pressSequentially('Concep', { delay: 110 }); await sleep(500);
    await click('#pickList button.rl-match', { after: 300 }); await app().waitForSelector('#work .rcard', { timeout: 30000 }).catch(() => {}); await sleep(900);
    await tile('1', 'place, one plain answer', 'scenario', 'scn', 'orange'); await click('#langBox [data-lang=es]', { after: 1500 }); await click('#langBox [data-lang=pt]', { after: 1400 }); await click('#langBox [data-lang=en]'); },
  async () => { await scene(11, 'Arjun: <em>every number</em>', 'fireverse / explorer'); await go('index.html', '[data-page=harmonization]'); await sleep(2500);
    await tile(await numNear('MODIS detections'), 'MODIS detections, 7 days', 'observed', 'obs', 'green'); await sleep(1200); await tile(await numNear('VIIRS detections'), 'VIIRS detections, same days', 'observed', 'obs', 'blue'); await sleep(1500);
    await tile(await numNear('Harmonized observations'), 'harmonized: each fire counted once', 'observed', 'obs', 'orange'); await point('text=Harmonized observations').catch(() => {}); },
  async () => { await scene(12, 'The lab and <em>the map</em>', 'fireverse / explorer'); await click('[data-page=harmonization]', { after: 4500 }); await tile('Lab', 'how detections were matched across satellites', 'observed', 'obs', 'green');
    await click('[data-page=map]', { after: 3000 }); await tile('Map', 'every dot a real NASA detection', 'observed', 'obs', 'green'); },
  async () => { await scene(13, 'FIRELAB: <em>where the smoke goes</em>', 'fireverse / firelab'); await firelab();
    const fire = await app().locator('#simFire option:checked').textContent().catch(() => ''); const ws = (await app().locator('#simHudSpeed').textContent().catch(() => '')).match(/[\d.]+/);
    await tile(numOf((fire.match(/[\d.]+ MW/) || ['?'])[0]), 'MW fire power, measured from space', 'observed', 'obs', 'green'); await sleep(2000);
    await tile(ws ? ws[0] : '?', 'm/s wind at that hour, from a weather model', 'modelled', 'mod', 'blue'); await sleep(1500); await click('#simPlay', { after: 300 }); await sleep(4500);
    const hrs = await text('#simHoursV').catch(() => ''); await tile(numOf(hrs) + ' h', 'of smoke so far, one model run per hour', 'scenario', 'scn', 'orange'); },
  async () => { await scene(14, 'One <em>watch list</em>', 'fireverse / downwind · Paraguay'); await go('downwind.html?r=PY', '[data-kind=power]'); await sleep(1500);
    const n = await app().locator('#nPower').textContent().catch(() => '?'); await tile(n || '?', 'power lines with smoke reaching them, last 24 h', 'scenario', 'scn', 'orange');
    await click('[data-kind=roads]', { after: 1500 }); await click('[data-kind=health]', { after: 1500 }); await click('[data-kind=power]', { after: 2500 }); await click('[data-mode=fast]', { after: 2000 });
    await tile('10 min', 'fast look: coarse pixels, labelled as such', 'fast', 'fast', 'blue'); await sleep(1200); await click('[data-mode=live]', { after: 400 }); },
  async () => { await scene(15, 'Real test: <em>a line trip</em>', 'fireverse / downwind · replay 8 Jan 2025'); await click('[data-mode=replay]', { after: 300 }); await app().waitForSelector('#dwReplay:not([hidden]) .dw-rp-grid', { timeout: 60000 }); await sleep(800);
    const s = await text('#dwReplay'); const m = s.match(/(\d+) fire clusters/);
    await tile(m ? m[1] : '?', 'fire clusters near the park in the 12 hours before', 'observed', 'obs', 'green'); await sleep(6500); await tile('2', 'places where modelled smoke crosses a 500 kV line', 'scenario', 'scn', 'orange'); await sleep(6000);
    await tile('0', 'minutes of same-day warning', 'limit', 'you', 'blue'); await app().evaluate(() => document.querySelector('#dwReplay').scrollIntoView({ block: 'start', behavior: 'smooth' })); },
  async () => { await scene(16, 'Next: <em>smoke in every map app</em>', 'fireverse / route planner · Paraguay'); await go('route.html?r=PY', '#rtExample'); await sleep(500); await click('#rtExample', { after: 400 });
    await app().waitForSelector('#rtRoutes .rt-route', { timeout: 90000 }).catch(() => {}); await sleep(800);
    await tile('Now', 'map apps show the air quality right now', '', '', 'blue'); await sleep(3500); await tile('Next', 'the smoke ahead on your route', 'built: first version', 'you', 'orange');
    await point('#rtGeojson', { after: 1500 }).catch(() => {}); await tile('File', 'smoke along each route, ready for a map app to read', 'scenario', 'scn', 'green'); await point('#rtGmaps').catch(() => {}); },
  async () => { await scene(17, 'What is the smoke <em>about to cross?</em>', 'fireverse / start'); await app().evaluate(() => localStorage.removeItem('fv.role')); await go('start.html', '#dealBtn'); await page.evaluate(() => window.castLine(true)); },
];

await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await sleep(400); const T0 = Date.now() / 1000; let at = T0; const late = [];
for (let i = 0; i < scenes.length; i++) {
  const who = SAY[i][0] === 'narrator' ? null : SAY[i][0];
  await page.evaluate(([w, c, words, lead]) => { window.speaker(w); window.captions(c, w); if (w) window.talk(words, lead); }, [who, CAPS[i], WORDS[i], LEAD]);
  try { await scenes[i](); } catch (e) { console.log(`scene ${i + 1} problem: ${e.message.split('\n')[0]}`); }
  at += dur[i]; const left = at - Date.now() / 1000; if (left < 0) { late.push(`scene ${i + 1} ran ${(-left).toFixed(1)} s over`); dur[i] -= left; at -= left; } else await sleep(left * 1000);
}
await sleep(1200); dur[dur.length - 1] += 1.2;
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
  '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '21', '-preset', 'medium', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', OUT]);
console.log(`${fr.length} frames, ${(TEND - T0).toFixed(1)} s -> ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
fs.rmSync(TMP, { recursive: true, force: true });
