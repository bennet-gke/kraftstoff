/**
 * KRAFTSTOFF - TensorFlow.js Preis-Forecaster (On-Device, 100% echte Daten)
 *
 * Das neuronale Netz lernt ausschließlich aus den echten Messwerten der Tankstellen im gewählten Bereich:
 * Gegeben Stunde/Wochentag, Markenklasse, aktueller Abstand einer Station zu ihrem gleitenden Niveau und
 * ein Zeithorizont (1–24 h), sagt es den relativen Preis (ct/L gegenüber dem Niveau) voraus.
 *
 * - TensorFlow.js wird erst nach dem App-Start nachgeladen (eigener Programmteil, schneller Start).
 * - Startet UNTRAINIERT. Trainingsdaten werden zur Stundenmitte abgetastet, nie über App-Pausen hinweg.
 * - Gewicht in der Prognose nur, wenn das Netz auf zurückgehaltenen (neuesten) Daten nachweislich besser ist
 *   als das statistische Regionsprofil – und erst ab 3 Beobachtungstagen.
 * - Gewichte in IndexedDB und als Snapshot in der Datenbank-Datei (Mac & iPhone teilen das Modell).
 */

import { idbGet, idbSet, idbDelete } from '../services/indexedDbStorage';
import { profileEstimateAt, sampleHourly, relativeSamples, stationLevelAt, PRIOR_HOURLY_CT, DAY_SHORT, toMondayIndex } from './regionalTrends';
import { applyRulesToForecast, DEFAULT_RULES } from './priceRules';

const MODEL_IDB_PATH = 'indexeddb://kraftstoff-tf-forecaster-v3';
const LEGACY_MODEL_PATHS = ['indexeddb://kraftstoff-tf-forecaster-v2'];
const META_IDB_KEY = 'kraftstoff_ml_meta_v3';
const LEGACY_META_KEYS = ['kraftstoff_ml_meta_v2'];
const MODEL_VERSION = 3;
const INPUT_DIM = 9;
const MIN_SAMPLES_FOR_USE = 150;
const MIN_DAYS_FOR_USE = 3;
const MAX_TRAIN_SAMPLES = 4000;
const MIN_TRAIN_INTERVAL_MS = 20 * 60 * 1000;
const HORIZONS = [1, 2, 3, 4, 6, 9, 12, 18, 24];
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const REL_SCALE_CT = 10; // ±10 ct -> ±1
const MAX_BLEND = 0.8;

let tf = null;
let tfPromise = null;
let model = null;
let isTraining = false;
let trainingPromise = null;
let initPromise = null;
let lastTrainingAt = 0;
let trustedWeights = false;

let status = {
  phase: 'idle', // idle | loading | collecting | training | ready | error
  ready: false,
  samplesLearned: 0,
  stationsLearned: 0,
  daysLearned: 0,
  trainingRuns: 0,
  epochsTotal: 0,
  lastLoss: null,
  lastTrainedAt: null,
  lastDatasetSize: 0,
  validation: null, // { nnMaeCt, profileMaeCt, n }
  isPersisted: false,
  backend: null,
  blendWeight: 0,
  lastError: null,
  modelVersion: MODEL_VERSION,
};

const listeners = new Set();

function notify() {
  const snapshot = { ...status };
  listeners.forEach((fn) => {
    try { fn(snapshot); } catch {}
  });
}

export function subscribeMLStatus(callback) {
  listeners.add(callback);
  callback({ ...status });
  return () => listeners.delete(callback);
}

export function getMLStatus() {
  return { ...status };
}

/** TensorFlow.js bei Bedarf nachladen (eigener Programmteil). */
async function loadTf() {
  if (tf) return tf;
  if (!tfPromise) {
    tfPromise = import('@tensorflow/tfjs').then((m) => {
      tf = m;
      return m;
    });
  }
  return tfPromise;
}

/**
 * Anteil des neuronalen Netzes an der Prognose: nur bei nachgewiesenem Vorteil gegenüber dem Profil
 * (Validierung auf den neuesten, beim Training zurückgehaltenen Daten) und ausreichender Datenbasis.
 */
export function blendWeightFor(samples, validation = status.validation, days = status.daysLearned) {
  if (!samples || samples < MIN_SAMPLES_FOR_USE || (days || 0) < MIN_DAYS_FOR_USE) return 0;
  if (!validation || !(validation.profileMaeCt > 0) || !Number.isFinite(validation.nnMaeCt)) return 0;
  const skill = 1 - validation.nnMaeCt / validation.profileMaeCt;
  if (skill <= 0.02) return 0;
  const dataFactor = Math.min(1, samples / 1500);
  return Math.round(Math.min(MAX_BLEND, skill * 1.6) * dataFactor * 100) / 100;
}

function compile(m) {
  m.compile({ optimizer: tf.train.adam(0.004), loss: 'meanSquaredError' });
  return m;
}

function buildModel() {
  const m = tf.sequential();
  m.add(tf.layers.dense({ inputShape: [INPUT_DIM], units: 32, activation: 'relu', kernelInitializer: 'glorotNormal' }));
  m.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  m.add(tf.layers.dense({ units: 1, activation: 'linear' }));
  return compile(m);
}

const PREMIUM_BRANDS = ['aral', 'shell', 'esso', 'total', 'bp', 'agip', 'eni', 'omv'];
const DISCOUNT_BRANDS = ['jet', 'star', 'hem', 'oil!', 'oil ', 'avia', 'hoyer', 'classic', 'globus', 'raiffeisen', 'bft', 'q1', 'go ', 'nordoel', 'sprint', 'team', 'tankpoint', 'm1', 'score', 'markant', 'calpam', 'supermarkt', 'famila', 'edeka', 'rewe', 'freie'];

export function brandTier(brand) {
  const b = (brand || '').toLowerCase().trim();
  if (!b) return 0.5;
  if (PREMIUM_BRANDS.some((p) => b.startsWith(p))) return 1.0;
  if (DISCOUNT_BRANDS.some((d) => b.startsWith(d) || b.includes(d))) return 0.0;
  return 0.5;
}

function stationHash(id) {
  let hash = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash % 1000) / 1000;
}

/**
 * Merkmalsvektor (9 Werte in [-1.5, 1.5]):
 * Zielstunde (sin/cos), Zielwochentag (sin/cos), Wochenende, Horizont, Markenklasse,
 * Stations-Hash, aktueller Abstand zum Stationsniveau.
 */
export function extractFeatures({ targetMs, hoursAhead, brand, stationId, lastRelCt }) {
  const d = new Date(targetMs);
  const hourFrac = (d.getHours() + d.getMinutes() / 60) / 24;
  const dayFrac = toMondayIndex(d.getDay()) / 7;
  const isWeekend = d.getDay() === 0 || d.getDay() === 6 ? 1 : 0;
  const rel = Math.max(-1.5, Math.min(1.5, (lastRelCt || 0) / REL_SCALE_CT));
  return [
    Math.sin(2 * Math.PI * hourFrac),
    Math.cos(2 * Math.PI * hourFrac),
    Math.sin(2 * Math.PI * dayFrac),
    Math.cos(2 * Math.PI * dayFrac),
    isWeekend,
    Math.min(1, hoursAhead / 24),
    brandTier(brand),
    stationHash(stationId),
    rel,
  ];
}

/** Profil-Vorhersage (Baseline) für den relativen Preis zur Zeit t1 ausgehend von t0. */
function profileBaseline(profile, t0, t1, hoursAhead, lastRelCt) {
  const e0 = profileEstimateAt(profile, t0).est;
  const e1 = profileEstimateAt(profile, t1).est;
  return e1 + (lastRelCt - e0) * Math.exp(-hoursAhead / 10);
}

/**
 * Baut den Trainingsdatensatz aus echten Messreihen (Reservoir-Stichprobe, speicherschonend).
 * Ziel: relativer Preis zum Zeitpunkt t0+h gegenüber dem gleitenden Niveau zum Zeitpunkt t0.
 * @param {Map<string, Array>} readingsMap  stationId -> Messpunkte
 * @param {Map<string, Object>} stationsMeta stationId -> { brand }
 */
export function buildTrainingDataset(readingsMap, stationsMeta, { now = Date.now(), lookbackDays = 28, maxSamples = MAX_TRAIN_SAMPLES, profile = null } = {}) {
  const estFn = (h) => profile?.hourOfDay?.[h]?.est ?? (profile?.prior || PRIOR_HOURLY_CT)[h];
  const fromMs = now - lookbackDays * DAY_MS;
  const reservoir = [];
  let seen = 0;
  let stationsUsed = 0;
  const days = new Set();

  for (const [stationId, pts] of readingsMap || []) {
    if (!pts || pts.length < 6) continue;
    const samples = sampleHourly(pts, fromMs, now);
    if (samples.length < 6) continue;
    const rel = relativeSamples(samples, estFn);
    if (rel.length === 0) continue;
    const byT = new Map(samples.map((s) => [s.t, s.p]));
    const brand = stationsMeta?.get?.(stationId)?.brand || '';
    let used = 0;
    for (const s0 of rel) {
      // nur jede zweite Stunde als Ausgangspunkt (weniger stark korrelierte Beispiele)
      if (Math.floor(s0.t / HOUR_MS) % 2 !== 0) continue;
      for (const h of HORIZONS) {
        const t1 = s0.t + h * HOUR_MS;
        const p1 = byT.get(t1);
        if (p1 === undefined) continue;
        const item = { t0: s0.t, t1, h, brand, stationId, lastRelCt: s0.rel, target: (p1 - s0.level) * 100 };
        seen += 1;
        used += 1;
        if (reservoir.length < maxSamples) reservoir.push(item);
        else {
          const j = Math.floor(Math.random() * seen);
          if (j < maxSamples) reservoir[j] = item;
        }
      }
      days.add(new Date(s0.t).toDateString());
    }
    if (used > 0) stationsUsed += 1;
  }

  // Zeitliche Aufteilung: die neuesten 20 % (nach Ausgangszeit) dienen der Validierung
  reservoir.sort((a, b) => a.t0 - b.t0);
  const cut = Math.floor(reservoir.length * 0.8);
  const toX = (it) => extractFeatures({ targetMs: it.t1, hoursAhead: it.h, brand: it.brand, stationId: it.stationId, lastRelCt: it.lastRelCt });
  const toY = (it) => [Math.max(-1.5, Math.min(1.5, it.target / REL_SCALE_CT))];
  const train = reservoir.slice(0, cut);
  const valid = reservoir.slice(cut);
  return {
    xs: train.map(toX),
    ys: train.map(toY),
    valid,
    validXs: valid.map(toX),
    stationsUsed,
    totalAvailable: seen,
    daysCovered: days.size,
  };
}

async function loadMeta() {
  try {
    const meta = await idbGet(META_IDB_KEY);
    return meta && typeof meta === 'object' ? meta : null;
  } catch {
    return null;
  }
}

async function saveMeta() {
  const meta = {
    samplesLearned: status.samplesLearned,
    stationsLearned: status.stationsLearned,
    daysLearned: status.daysLearned,
    trainingRuns: status.trainingRuns,
    epochsTotal: status.epochsTotal,
    lastLoss: status.lastLoss,
    lastTrainedAt: status.lastTrainedAt,
    lastDatasetSize: status.lastDatasetSize,
    validation: status.validation,
  };
  await idbSet(META_IDB_KEY, meta).catch(() => {});
}

async function persistModel() {
  if (!model) return false;
  try {
    await model.save(MODEL_IDB_PATH);
    status.isPersisted = true;
    return true;
  } catch (e) {
    console.warn('KI-Modell konnte nicht in IndexedDB gesichert werden:', e);
    status.isPersisted = false;
    return false;
  }
}

function resetStatusCounters() {
  status = {
    ...status,
    ready: false,
    samplesLearned: 0,
    stationsLearned: 0,
    daysLearned: 0,
    trainingRuns: 0,
    epochsTotal: 0,
    lastLoss: null,
    lastTrainedAt: null,
    lastDatasetSize: 0,
    validation: null,
    isPersisted: false,
    blendWeight: 0,
  };
}

function settlePhase() {
  status.blendWeight = trustedWeights ? blendWeightFor(status.samplesLearned) : 0;
  status.ready = trustedWeights && status.samplesLearned >= MIN_SAMPLES_FOR_USE;
  status.phase = status.ready ? 'ready' : 'collecting';
}

/** Initialisiert TF.js und lädt ein ggf. gespeichertes Modell. Trainiert NICHT synthetisch. */
export async function initModel() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    status.phase = 'loading';
    notify();
    try {
      await loadTf();
      await tf.ready();
      status.backend = tf.getBackend();
      // Alte Modellversionen (anderes Trainingsziel) verwerfen
      for (const p of LEGACY_MODEL_PATHS) await tf.io.removeModel(p).catch(() => {});
      for (const k of LEGACY_META_KEYS) await idbDelete(k).catch(() => {});

      const meta = await loadMeta();
      try {
        const models = await tf.io.listModels();
        if (models[MODEL_IDB_PATH] && meta) {
          const loaded = await tf.loadLayersModel(MODEL_IDB_PATH);
          const inShape = loaded.inputs?.[0]?.shape;
          if (inShape && inShape[inShape.length - 1] === INPUT_DIM) {
            model = compile(loaded);
            trustedWeights = true;
            status = { ...status, ...meta, isPersisted: true, modelVersion: MODEL_VERSION };
          } else {
            loaded.dispose();
            await tf.io.removeModel(MODEL_IDB_PATH).catch(() => {});
          }
        }
      } catch (e) {
        console.info('Kein gespeichertes KI-Modell gefunden, starte frisch:', e?.message || e);
      }
      if (!model) {
        // Ohne passende Gewichte gilt auch der gespeicherte Lernstand nicht
        model = buildModel();
        trustedWeights = false;
        resetStatusCounters();
        await idbDelete(META_IDB_KEY).catch(() => {});
      }
      settlePhase();
    } catch (err) {
      console.error('TensorFlow.js konnte nicht initialisiert werden:', err);
      status.phase = 'error';
      status.ready = false;
      status.lastError = 'TensorFlow.js ist auf diesem Gerät nicht verfügbar.';
    }
    notify();
    return model;
  })();
  return initPromise;
}

function maeOf(pred, truth) {
  if (pred.length === 0) return null;
  let s = 0;
  for (let i = 0; i < pred.length; i++) s += Math.abs(pred[i] - truth[i]);
  return s / pred.length;
}

/**
 * Trainiert das Netz inkrementell auf den echten Messreihen des aktuellen Bereichs und validiert es gegen
 * das Regionsprofil auf den neuesten Daten.
 * @returns {Promise<{trained:boolean, reason?:string, samples?:number}>}
 */
export async function trainOnHistory({ readingsMap, stationsMeta, epochs = 4, force = false, now = Date.now(), profile = null } = {}) {
  await initModel();
  if (!model || !tf || status.phase === 'error') return { trained: false, reason: 'error' };
  if (isTraining) return { trained: false, reason: 'busy' };
  if (!force && now - lastTrainingAt < MIN_TRAIN_INTERVAL_MS) return { trained: false, reason: 'throttled' };
  if (!readingsMap || readingsMap.size === 0) return { trained: false, reason: 'no-data' };

  const dataset = buildTrainingDataset(readingsMap, stationsMeta, { now, profile });
  if (dataset.xs.length < MIN_SAMPLES_FOR_USE) {
    status.lastDatasetSize = dataset.xs.length;
    settlePhase();
    notify();
    return { trained: false, reason: 'insufficient', samples: dataset.xs.length };
  }

  isTraining = true;
  lastTrainingAt = now;
  const phaseBefore = status.phase;
  status.phase = 'training';
  status.lastError = null;
  notify();

  const run = (async () => {
    const xT = tf.tensor2d(dataset.xs);
    const yT = tf.tensor2d(dataset.ys);
    try {
      let lossOk = true;
      await model.fit(xT, yT, {
        epochs,
        batchSize: 64,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            if (!Number.isFinite(logs?.loss)) {
              lossOk = false;
              model.stopTraining = true;
              return;
            }
            status.lastLoss = Math.round(logs.loss * 10000) / 10000;
            status.epochsTotal += 1;
            notify();
          },
        },
      });
      if (!lossOk) throw new Error('Training divergiert (ungültiger Fehlerwert).');

      // Validierung gegen das Regionsprofil auf den neuesten Daten
      let validation = null;
      if (dataset.validXs.length >= 30) {
        const out = tf.tidy(() => model.predict(tf.tensor2d(dataset.validXs)));
        const nnPred = Array.from(out.dataSync()).map((v) => v * REL_SCALE_CT);
        out.dispose();
        if (nnPred.every(Number.isFinite)) {
          const truth = dataset.valid.map((it) => it.target);
          const prof = dataset.valid.map((it) => profileBaseline(profile, it.t0, it.t1, it.h, it.lastRelCt));
          validation = {
            nnMaeCt: Math.round(maeOf(nnPred, truth) * 100) / 100,
            profileMaeCt: Math.round(maeOf(prof, truth) * 100) / 100,
            n: truth.length,
          };
        }
      }

      trustedWeights = true;
      status.samplesLearned = Math.max(status.samplesLearned, dataset.totalAvailable);
      status.stationsLearned = Math.max(status.stationsLearned, dataset.stationsUsed);
      status.daysLearned = Math.max(status.daysLearned || 0, dataset.daysCovered);
      status.trainingRuns += 1;
      status.lastTrainedAt = new Date(now).toISOString();
      status.lastDatasetSize = dataset.xs.length;
      if (validation) status.validation = validation;
      settlePhase();
      if (await persistModel()) await saveMeta();
      return { trained: true, samples: dataset.xs.length };
    } catch (e) {
      console.warn('KI-Training fehlgeschlagen:', e);
      status.lastError = e?.message || 'Training fehlgeschlagen.';
      status.phase = phaseBefore === 'training' ? 'collecting' : phaseBefore;
      settlePhase();
      return { trained: false, reason: 'error' };
    } finally {
      xT.dispose();
      yT.dispose();
      isTraining = false;
      notify();
    }
  })();
  trainingPromise = run;
  return run;
}

/** Löscht Modell & Lernstand und beginnt von vorn (wartet ein laufendes Training ab). */
export async function resetModel() {
  await initModel();
  if (isTraining && model) {
    model.stopTraining = true;
    try { await trainingPromise; } catch {}
  }
  try { if (tf) await tf.io.removeModel(MODEL_IDB_PATH); } catch {}
  await idbDelete(META_IDB_KEY).catch(() => {});
  if (model) { try { model.dispose(); } catch {} }
  model = tf ? buildModel() : null;
  trustedWeights = false;
  lastTrainingAt = 0;
  resetStatusCounters();
  status.lastError = null;
  settlePhase();
  notify();
}

/**
 * 24h-Prognose für eine Station: Mischung aus neuronalem Netz (sofern validiert besser) und Regionsprofil.
 * Die aktuelle Abweichung der Station von ihrem Niveau klingt im Profilanteil über ~10 Stunden ab.
 * Funktioniert auch, solange TensorFlow.js noch nicht geladen ist (dann reines Profil).
 */
export function forecastStationCurve({ station, pts = [], profile, hours = 24, now = Date.now(), rules = DEFAULT_RULES }) {
  if (!station || !Number.isFinite(station.currentPrice)) return null;
  const nowCell = profileEstimateAt(profile, now);
  const estFn = (h) => profile?.hourOfDay?.[h]?.est ?? (profile?.prior || PRIOR_HOURLY_CT)[h];
  // Niveau aus den letzten 24 h; ohne genug eigene Daten: aktueller Preis abzüglich der typischen Lage jetzt
  const histLevel = pts.length >= 3 ? stationLevelAt(pts, now, estFn) : null;
  const level = histLevel !== null ? histLevel : station.currentPrice - nowCell.est / 100;
  const lastRelCt = (station.currentPrice - level) * 100;
  const w = model && tf && status.ready ? status.blendWeight : 0;

  const steps = [];
  for (let h = 0; h <= hours; h++) {
    const t = now + h * HOUR_MS;
    const cell = profileEstimateAt(profile, t);
    const profRel = cell.est + (lastRelCt - nowCell.est) * Math.exp(-h / 10);
    steps.push({ h, t, profRel, conf: cell.conf });
  }

  let nnRel = null;
  if (w > 0) {
    try {
      const feats = steps.map((s) => extractFeatures({ targetMs: s.t, hoursAhead: s.h, brand: station.brand, stationId: station.id, lastRelCt }));
      const out = tf.tidy(() => model.predict(tf.tensor2d(feats)));
      const arr = Array.from(out.dataSync());
      out.dispose();
      nnRel = arr.every(Number.isFinite) ? arr.map((v) => Math.max(-15, Math.min(15, v * REL_SCALE_CT))) : null;
    } catch (e) {
      console.warn('KI-Inferenz fehlgeschlagen, nutze Regionsprofil:', e);
      nnRel = null;
    }
  }

  const curve = steps.map((s, i) => {
    const rel = nnRel ? w * nnRel[i] + (1 - w) * s.profRel : s.profRel;
    const d = new Date(s.t);
    const price = Math.round((level + rel / 100) * 1000) / 1000;
    return {
      hoursAhead: s.h,
      t: s.t,
      hour: d.getHours(),
      hourFormatted: `${d.getHours()}:00`,
      dayShort: DAY_SHORT[toMondayIndex(d.getDay())],
      price,
      relCt: Math.round(rel * 10) / 10,
      conf: s.conf,
      isLowest: false,
      isHighest: false,
    };
  });
  // Stunde 0 = jetzt: realer Preis
  curve[0].price = station.currentPrice;

  // Gesetze: Erhöhungen nur zu erlaubten Zeiten, Stichtags-Änderungen verschieben das Niveau
  if (rules && (rules.increase.length > 0 || rules.steps.length > 0)) {
    const capped = applyRulesToForecast(curve, rules);
    for (let i = 1; i < curve.length; i++) {
      if (capped[i].price !== curve[i].price) {
        curve[i].price = capped[i].price;
        curve[i].relCt = Math.round((capped[i].price - level) * 1000) / 10;
      }
    }
  }

  let lowest = curve[0];
  let highest = curve[0];
  for (const c of curve) {
    if (c.price < lowest.price) lowest = c;
    if (c.price > highest.price) highest = c;
  }
  lowest.isLowest = true;
  highest.isHighest = true;

  return {
    curve,
    lowest,
    highest,
    level: Math.round(level * 1000) / 1000,
    levelFromHistory: histLevel !== null,
    nnWeight: Math.round(w * 100) / 100,
    sourceLabel: nnRel ? `KI-Prognose (${Math.round(w * 100)} % neuronales Netz, ${Math.round((1 - w) * 100)} % Regionsprofil)` : 'Prognose aus dem Regionsprofil',
    usesNeuralNet: !!nnRel,
    potentialSavingsCent: Math.round((station.currentPrice - lowest.price) * 1000) / 10,
  };
}

/** Kompakter Snapshot (Gewichte + Lernstand) für die Datenbank-Datei – nur von echt trainierten Gewichten. */
export async function getModelSnapshot() {
  await initModel();
  if (!model || !tf || !trustedWeights || status.samplesLearned < MIN_SAMPLES_FOR_USE) return null;
  try {
    const layers = model.getWeights().map((w) => ({ shape: w.shape, data: Array.from(w.dataSync()).map((v) => Math.round(v * 1e6) / 1e6) }));
    if (!layers.every((l) => l.data.every(Number.isFinite))) return null;
    return {
      version: MODEL_VERSION,
      inputDim: INPUT_DIM,
      layers,
      meta: {
        samplesLearned: status.samplesLearned,
        stationsLearned: status.stationsLearned,
        daysLearned: status.daysLearned,
        trainingRuns: status.trainingRuns,
        epochsTotal: status.epochsTotal,
        lastLoss: status.lastLoss,
        lastTrainedAt: status.lastTrainedAt,
        lastDatasetSize: status.lastDatasetSize,
        validation: status.validation,
      },
    };
  } catch (e) {
    console.warn('KI-Snapshot konnte nicht erzeugt werden:', e);
    return null;
  }
}

/** Übernimmt einen Snapshot (z.B. vom anderen Gerät), wenn er mehr gelernt hat als das lokale Modell. */
export async function loadModelSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== MODEL_VERSION || snapshot.inputDim !== INPUT_DIM || !Array.isArray(snapshot.layers)) return false;
  await initModel();
  if (!model || !tf || isTraining) return false;
  const incoming = Number(snapshot.meta?.samplesLearned) || 0;
  if (incoming < MIN_SAMPLES_FOR_USE || (trustedWeights && incoming <= status.samplesLearned)) return false;
  try {
    const current = model.getWeights();
    if (current.length !== snapshot.layers.length) return false;
    const sameShapes = current.every((w, i) => JSON.stringify(w.shape) === JSON.stringify(snapshot.layers[i].shape));
    if (!sameShapes || !snapshot.layers.every((l) => Array.isArray(l.data) && l.data.every(Number.isFinite))) return false;
    const tensors = snapshot.layers.map((l) => tf.tensor(l.data, l.shape));
    model.setWeights(tensors);
    tensors.forEach((t) => t.dispose());
    trustedWeights = true;
    status = { ...status, ...snapshot.meta };
    settlePhase();
    if (await persistModel()) await saveMeta();
    notify();
    return true;
  } catch (e) {
    console.warn('KI-Snapshot konnte nicht geladen werden:', e);
    return false;
  }
}
