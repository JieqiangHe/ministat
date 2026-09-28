/* ============================================================
   ministat — statistics core
   Pure functions, no DOM. Loaded as window.Stats in the browser
   and via require() in Node (tests).
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("jstat"));
  else root.Stats = factory(root.jStat);
})(typeof self !== "undefined" ? self : this, function (jStat) {
"use strict";

/* ============================================================
   PARSING
   ============================================================ */
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const THOUSANDS_RE = /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?(e[+-]?\d+)?$/i;

/* Strict number parser. Accepts "1.5", "-2e3", "1,234.5" (grouped thousands).
   Rejects anything ambiguous — "1,5" (decimal comma), "0x1A", "12abc" — as NaN
   so the grid can flag it instead of silently reading a wrong value. */
function parseNum(s) {
  if (typeof s === "number") return s;
  if (s == null) return NaN;
  let t = String(s).trim().replace(/[−‒–]/g, "-"); // typographic minus signs
  if (t === "") return NaN;
  if (THOUSANDS_RE.test(t)) t = t.replace(/,/g, "");
  return NUM_RE.test(t) ? Number(t) : NaN;
}

/* Parse pasted TSV / CSV / semicolon-separated text into rows of cells.
   The delimiter is chosen once from the first line (tab > ; > ,), so a
   thousands separator inside a TSV cell is never split. Supports "quoted" cells. */
function parseDelimited(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim() !== "");
  if (!lines.length) return [];
  const first = lines[0];
  const delim = first.includes("\t") ? "\t" : (first.includes(";") ? ";" : ",");
  return lines.map(l => splitLine(l, delim));
}
function splitLine(line, d) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false; }
      else cur += ch;
    } else if (ch === '"' && cur.trim() === "") { quoted = true; cur = ""; }
    else if (ch === d) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/* ============================================================
   DESCRIPTIVE
   ============================================================ */
function describe(v) {
  const n = v.length;
  if (n === 0) return { n: 0 };
  const mean = jStat.mean(v);
  const sd = n > 1 ? jStat.stdev(v, true) : NaN;      // sample SD (n-1)
  const sem = n > 1 ? sd / Math.sqrt(n) : NaN;
  const sorted = [...v].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75);
  const tc = n > 1 ? jStat.studentt.inv(0.975, n - 1) : NaN;
  return { n, mean, sd, sem, median, min: sorted[0], max: sorted[n - 1], q1, q3, iqr: q3 - q1,
           variance: n > 1 ? sd * sd : NaN, ciLo: mean - tc * sem, ciHi: mean + tc * sem };
}
function quantile(sorted, p) {  // linear interpolation (type-7, matches Excel/R default)
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const h = (n - 1) * p, lo = Math.floor(h);
  return sorted[lo] + (h - lo) * (sorted[Math.min(lo + 1, n - 1)] - sorted[lo]);
}

/* ============================================================
   DISTRIBUTION HELPERS  (upper tails computed directly for precision)
   ============================================================ */
const normCdf = (z) => jStat.normal.cdf(z, 0, 1);
const normpdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
const pNorm2 = (z) => Math.min(1, 2 * normCdf(-Math.abs(z)));                   // two-sided
const pT2 = (t, df) => Math.min(1, 2 * jStat.studentt.cdf(-Math.abs(t), df));   // two-sided
function pFUpper(F, d1, d2) {
  if (F === Infinity) return 0;
  if (!(F >= 0)) return NaN;
  return jStat.ibeta(d2 / (d2 + d1 * F), d2 / 2, d1 / 2);
}
function pChi2Upper(x, df) {
  if (!(x >= 0)) return NaN;
  return Math.max(0, 1 - jStat.lowRegGamma(df / 2, x / 2));
}

/* ---- Gauss–Legendre quadrature nodes (computed once per order) ---- */
const GL_CACHE = {};
function gaussLegendre(n) {
  if (GL_CACHE[n]) return GL_CACHE[n];
  const x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < Math.ceil(n / 2); i++) {
    let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), pp = 1;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      pp = n * (z * p1 - p2) / (z * z - 1);
      const z1 = z; z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    x[i] = -z; x[n - 1 - i] = z;
    w[i] = w[n - 1 - i] = 2 / ((1 - z * z) * pp * pp);
  }
  return (GL_CACHE[n] = { x, w });
}

/* Integrate g(u) · f_df(u) over u = sqrt(chi2_df / df), the scale factor that
   turns a normal statistic into a studentized one. Gauss–Legendre on a window of
   ±9 approximate SDs around the density's mode — accurate to ~1e-7 for any df. */
function integrateOverChi(df, g) {
  if (!isFinite(df) || df > 25000) return g(1);
  const c = df / 2;
  const logK = Math.log(2) + c * Math.log(c) - jStat.gammaln(c);
  const spread = 9 / Math.sqrt(2 * df);
  const lo = Math.max(0, 1 - spread), hi = 1 + Math.max(spread, 3);
  const { x, w } = gaussLegendre(64);
  const half = (hi - lo) / 2, mid = (hi + lo) / 2;
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    const u = mid + half * x[i];
    if (u <= 0) continue;
    s += w[i] * g(u) * Math.exp(logK + (df - 1) * Math.log(u) - c * u * u);
  }
  return s * half;
}

/* Inner integrals over a standard normal z use the trapezoid rule on [-8, 8];
   for smooth, Gaussian-decaying integrands it converges exponentially fast. */
const Z_STEPS = 128, Z_LO = -8, Z_H = 16 / Z_STEPS;
const Z_GRID = Float64Array.from({ length: Z_STEPS + 1 }, (_, m) => Z_LO + m * Z_H);
const Z_PDF = Z_GRID.map(normpdf);
const Z_CDF = Z_GRID.map(normCdf);

/* ---- studentized range distribution (Tukey):  P(Q < q | k groups, df) ---- */
function ptukey(q, k, df) {
  if (!(q > 0)) return 0;
  const wprob = (w) => {   // P(range of k std normals < w) = ∫ k φ(z) [Φ(z) − Φ(z − w)]^(k−1) dz
    let s = 0;
    for (let m = 0; m <= Z_STEPS; m++) {
      const inner = Z_CDF[m] - normCdf(Z_GRID[m] - w);
      s += (m === 0 || m === Z_STEPS ? 0.5 : 1) * Z_PDF[m] * Math.pow(inner, k - 1);
    }
    return k * s * Z_H;
  };
  return Math.min(1, Math.max(0, integrateOverChi(df, u => wprob(q * u))));
}

/* ---- Dunnett many-to-one:  P(max_i |T_i| < t) ----
   Correlations between comparisons against the same control factor as
   ρ_ij = λ_i λ_j with λ_i = sqrt(n_i / (n_0 + n_i)), so the multivariate-t
   probability reduces to a 2-D integral (one shared normal, one chi scale). */
function pdunnett(t, lambdas, df) {
  if (!(t > 0)) return 0;
  const sd = lambdas.map(l => Math.sqrt(1 - l * l));
  const inner = (tu) => {
    let s = 0;
    for (let m = 0; m <= Z_STEPS; m++) {
      const z = Z_GRID[m];
      let prod = 1;
      for (let i = 0; i < lambdas.length; i++) {
        const lz = lambdas[i] * z;
        prod *= normCdf((tu - lz) / sd[i]) - normCdf((-tu - lz) / sd[i]);
      }
      s += (m === 0 || m === Z_STEPS ? 0.5 : 1) * Z_PDF[m] * prod;
    }
    return s * Z_H;
  };
  return Math.min(1, Math.max(0, integrateOverChi(df, u => inner(t * u))));
}

/* invert a monotone CDF by bisection (used for simultaneous-CI critical values) */
function invertCdf(cdf, target) {
  let lo = 0, hi = 4, flo = cdf(lo) - target, fhi = cdf(hi) - target;
  while (fhi < 0 && hi < 1e4) { lo = hi; flo = fhi; hi *= 2; fhi = cdf(hi) - target; }
  // Illinois (modified regula falsi): bracketed like bisection, ~6–10 evaluations
  let side = 0;
  for (let i = 0; i < 60; i++) {
    const x = (lo * fhi - hi * flo) / (fhi - flo), fx = cdf(x) - target;
    if (Math.abs(fx) < 1e-9 || hi - lo < 1e-9) return x;
    if (fx < 0) { lo = x; flo = fx; if (side === -1) fhi /= 2; side = -1; }
    else { hi = x; fhi = fx; if (side === 1) flo /= 2; side = 1; }
  }
  return (lo + hi) / 2;
}
const qtukey = (p, k, df) => invertCdf(q => ptukey(q, k, df), p);
const qdunnett = (p, lambdas, df) => invertCdf(t => pdunnett(t, lambdas, df), p);

/* ---- multiple-comparison adjustment ---- */
function adjustP(ps, method) {
  const m = ps.length;
  if (method === "bonferroni") return ps.map(p => Math.min(1, p * m));
  if (method === "holm") {
    const order = ps.map((p, i) => i).sort((a, b) => ps[a] - ps[b]);
    const out = new Array(m);
    let running = 0;
    order.forEach((idx, rank) => {
      running = Math.max(running, Math.min(1, (m - rank) * ps[idx]));
      out[idx] = running;
    });
    return out;
  }
  return ps.slice();
}

/* ---- ranks with average ties; returns ranks + Σ(t³ − t) tie term ---- */
function rankAll(values) {
  const idx = values.map((x, i) => i).sort((a, b) => values[a] - values[b]);
  const ranks = new Array(values.length);
  let tieSum = 0;
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j < idx.length && values[idx[j]] === values[idx[i]]) j++;
    const avg = (i + 1 + j) / 2, t = j - i;
    tieSum += t * t * t - t;
    for (let q = i; q < j; q++) ranks[idx[q]] = avg;
    i = j;
  }
  return { ranks, tieSum };
}

/* ============================================================
   TWO-GROUP TESTS
   ============================================================ */
function tTest(a, b, welch) {
  const A = describe(a), B = describe(b);
  const n1 = A.n, n2 = B.n, v1 = A.variance, v2 = B.variance;
  const diff = A.mean - B.mean;
  let df, se;
  const sp = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2)); // pooled SD
  if (welch) {
    se = Math.sqrt(v1 / n1 + v2 / n2);
    df = Math.pow(v1 / n1 + v2 / n2, 2) / (Math.pow(v1 / n1, 2) / (n1 - 1) + Math.pow(v2 / n2, 2) / (n2 - 1));
  } else {
    se = sp * Math.sqrt(1 / n1 + 1 / n2);
    df = n1 + n2 - 2;
  }
  const t = diff / se;
  const p = pT2(t, df);
  const tcrit = jStat.studentt.inv(0.975, df);
  const d = diff / sp;                                      // Cohen's d (pooled SD)
  const g = d * (1 - 3 / (4 * (n1 + n2) - 9));              // Hedges' g (small-sample corrected)
  return { A, B, diff, t, df, se, p, ci: [diff - tcrit * se, diff + tcrit * se], welch, d, g };
}

function pairedTTest(a, b) {
  const d = a.map((x, i) => x - b[i]);
  const D = describe(d), n = D.n;
  const se = D.sd / Math.sqrt(n), df = n - 1;
  const t = D.mean / se;
  const tcrit = jStat.studentt.inv(0.975, df);
  return { A: describe(a), B: describe(b), D, n, diff: D.mean, t, df, se, p: pT2(t, df),
           ci: [D.mean - tcrit * se, D.mean + tcrit * se], dz: D.mean / D.sd };
}

/* Null distribution of the Mann–Whitney U for sizes (m, n), no ties: the
   coefficients of the Gaussian binomial [m+n choose m]_q, built with the
   q-Pascal rule [N,k] = [N-1,k-1] + q^k [N-1,k]. All additions, so no cancellation. */
function mwuNullCounts(m, n) {
  let rows = [Float64Array.of(1)];
  for (let N = 1; N <= m + n; N++) {
    const next = [];
    for (let k = 0; k <= Math.min(N, m); k++) {
      const c = new Float64Array(k * (N - k) + 1);
      if (k > 0) { const a = rows[k - 1]; for (let i = 0; i < a.length; i++) c[i] += a[i]; }
      if (k <= N - 1 && rows[k]) { const b = rows[k]; for (let i = 0; i < b.length; i++) c[i + k] += b[i]; }
      next.push(c);
    }
    rows = next;
  }
  return rows[m];
}
/* Null distribution of the Wilcoxon signed-rank W+ for n pairs: subset sums of {1..n}. */
function signedRankNullCounts(n) {
  const S = n * (n + 1) / 2, c = new Float64Array(S + 1);
  c[0] = 1;
  for (let k = 1; k <= n; k++) for (let s = S; s >= k; s--) c[s] += c[s - k];
  return c;
}
/* two-sided exact p: 2 · min(P(X ≤ x), P(X ≥ x)) */
function exactTwoSided(counts, x) {
  let total = 0, le = 0, ge = 0;
  for (let i = 0; i < counts.length; i++) {
    total += counts[i];
    if (i <= x + 1e-9) le += counts[i];
    if (i >= x - 1e-9) ge += counts[i];
  }
  return Math.min(1, 2 * Math.min(le, ge) / total);
}

/* Mann–Whitney U. Exact null distribution when both n < 50 and there are no
   ties (same rule as R's wilcox.test); otherwise normal approximation with tie
   and continuity correction. */
function mannWhitney(a, b) {
  const A = describe(a), B = describe(b);
  const n1 = A.n, n2 = B.n, N = n1 + n2;
  const { ranks, tieSum } = rankAll(a.concat(b));
  let R1 = 0;
  for (let i = 0; i < n1; i++) R1 += ranks[i];
  const U1 = R1 - n1 * (n1 + 1) / 2;         // # pairs with a > b (ties count ½)
  const U2 = n1 * n2 - U1;
  const U = Math.min(U1, U2);
  const r = (U1 - U2) / (n1 * n2);           // rank-biserial correlation (+ ⇒ A tends larger)
  const exact = tieSum === 0 && n1 < 50 && n2 < 50;
  let z = NaN, p;
  if (exact) {
    p = exactTwoSided(mwuNullCounts(n1, n2), U1);
  } else {
    const sigma = Math.sqrt((n1 * n2 / 12) * ((N + 1) - tieSum / (N * (N - 1))));
    const dev = U1 - n1 * n2 / 2;
    z = sigma > 0 ? (dev - 0.5 * Math.sign(dev)) / sigma : 0;
    p = sigma > 0 ? pNorm2(z) : 1;
  }
  return { A, B, U1, U2, U, z, p, R1, r, exact };
}

/* Wilcoxon signed-rank (paired). Zero differences are dropped (Wilcoxon's
   method); exact when n < 50 with no ties/zeros, else normal approximation. */
function wilcoxonSignedRank(a, b) {
  // round away float noise so e.g. 12.8−12.0 and 10.9−10.1 tie, as they should
  const diffs = a.map((x, i) => +(x - b[i]).toPrecision(12));
  const nz = diffs.filter(d => d !== 0);
  const n = nz.length, zeros = diffs.length - n;
  const out = { A: describe(a), B: describe(b), D: describe(diffs), nPairs: diffs.length, n, zeros };
  if (n === 0) return Object.assign(out, { Wplus: 0, Wminus: 0, z: NaN, p: 1, r: 0, exact: false });
  const { ranks, tieSum } = rankAll(nz.map(Math.abs));
  let Wplus = 0;
  nz.forEach((d, i) => { if (d > 0) Wplus += ranks[i]; });
  const total = n * (n + 1) / 2, Wminus = total - Wplus;
  const r = (Wplus - Wminus) / total;            // matched-pairs rank-biserial
  const exact = tieSum === 0 && zeros === 0 && n < 50;
  let z = NaN, p;
  if (exact) p = exactTwoSided(signedRankNullCounts(n), Wplus);
  else {
    const sigma = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - tieSum / 48);
    const dev = Wplus - total / 2;
    z = sigma > 0 ? (dev - 0.5 * Math.sign(dev)) / sigma : 0;
    p = sigma > 0 ? pNorm2(z) : 1;
  }
  return Object.assign(out, { Wplus, Wminus, z, p, r, exact });
}

/* ============================================================
   K-GROUP TESTS
   ============================================================ */
function anova(groups) {
  const k = groups.length;
  const all = [].concat(...groups);
  const N = all.length;
  const grand = jStat.mean(all);
  const desc = groups.map(describe);
  let ssB = 0, ssW = 0;
  groups.forEach((g, i) => {
    ssB += g.length * Math.pow(desc[i].mean - grand, 2);
    g.forEach(v => { ssW += Math.pow(v - desc[i].mean, 2); });
  });
  const dfB = k - 1, dfW = N - k;
  const msB = ssB / dfB, msW = ssW / dfW;
  const F = msW > 0 ? msB / msW : (msB > 0 ? Infinity : NaN);
  const p = pFUpper(F, dfB, dfW);
  const ssT = ssB + ssW;
  const eta2 = ssB / ssT;
  const omega2 = (ssB - dfB * msW) / (ssT + msW);
  return { k, N, grand, desc, ssB, ssW, ssT, dfB, dfW, msB, msW, F, p, eta2, omega2 };
}

/* Post-hoc for one-way ANOVA (pooled MS_within):
   tukey | bonferroni | holm | dunnett (every group vs. group 0).
   Each comparison: { i, j, diff (mean_i − mean_j), p (adjusted), ci: [lo, hi] | null } */
function anovaPosthoc(av, method) {
  const { desc, msW, dfW, k } = av;
  const pairs = [];
  if (method === "dunnett") {
    const n0 = desc[0].n;
    const lambdas = [];
    for (let i = 1; i < k; i++) lambdas.push(Math.sqrt(desc[i].n / (n0 + desc[i].n)));
    const crit = qdunnett(0.95, lambdas, dfW);
    for (let i = 1; i < k; i++) {
      const diff = desc[i].mean - desc[0].mean;
      const se = Math.sqrt(msW * (1 / desc[i].n + 1 / n0));
      const t = diff / se;
      pairs.push({ i, j: 0, diff, stat: t, p: 1 - pdunnett(Math.abs(t), lambdas, dfW), ci: [diff - crit * se, diff + crit * se] });
    }
    return pairs;
  }
  const m = k * (k - 1) / 2;
  const qcrit = method === "tukey" ? qtukey(0.95, k, dfW) : NaN;
  const tBonf = jStat.studentt.inv(1 - 0.025 / m, dfW);
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
    const ni = desc[i].n, nj = desc[j].n;
    const diff = desc[i].mean - desc[j].mean;
    const se = Math.sqrt(msW * (1 / ni + 1 / nj));
    if (method === "tukey") {
      const q = Math.abs(diff) / (se / Math.SQRT2);      // Tukey–Kramer
      const h = qcrit * se / Math.SQRT2;
      pairs.push({ i, j, diff, stat: q, p: 1 - ptukey(q, k, dfW), ci: [diff - h, diff + h] });
    } else {
      const t = diff / se;
      pairs.push({ i, j, diff, stat: t, praw: pT2(t, dfW),
                   ci: method === "bonferroni" ? [diff - tBonf * se, diff + tBonf * se] : null });
    }
  }
  if (method !== "tukey") {
    const adj = adjustP(pairs.map(pr => pr.praw), method);
    pairs.forEach((pr, idx) => { pr.p = adj[idx]; });
  }
  return pairs;
}

/* Kruskal–Wallis H (tie-corrected), with Dunn's pairwise z-tests. */
function kruskalWallis(groups) {
  const k = groups.length;
  const all = [].concat(...groups);
  const N = all.length;
  const { ranks, tieSum } = rankAll(all);
  const meanRanks = [];
  let off = 0, sum = 0;
  groups.forEach(g => {
    let R = 0;
    for (let i = 0; i < g.length; i++) R += ranks[off + i];
    off += g.length;
    sum += R * R / g.length;
    meanRanks.push(R / g.length);
  });
  const C = 1 - tieSum / (N * N * N - N);
  const H = C > 0 ? (12 / (N * (N + 1)) * sum - 3 * (N + 1)) / C : 0;
  const df = k - 1;
  return { k, N, H, df, p: C > 0 ? pChi2Upper(H, df) : 1, eps2: H / (N - 1),
           meanRanks, tieSum, desc: groups.map(describe), groups };
}
function dunnTest(kw, method) {
  const { N, tieSum, meanRanks, groups, k } = kw;
  const v = N * (N + 1) / 12 - tieSum / (12 * (N - 1));
  const pairs = [];
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
    const diff = meanRanks[i] - meanRanks[j];
    const z = diff / Math.sqrt(v * (1 / groups[i].length + 1 / groups[j].length));
    pairs.push({ i, j, diff, stat: z, praw: pNorm2(z), ci: null });
  }
  const adj = adjustP(pairs.map(pr => pr.praw), method);
  pairs.forEach((pr, idx) => { pr.p = adj[idx]; });
  return pairs;
}

/* ============================================================
   ASSUMPTION CHECKS
   ============================================================ */
/* Shapiro–Wilk W (Royston 1995, algorithm AS R94 — same as R's shapiro.test).
   Valid for 3 ≤ n ≤ 5000; returns null otherwise or when all values are equal. */
function shapiroWilk(values) {
  const x = [...values].sort((a, b) => a - b);
  const n = x.length;
  if (n < 3 || n > 5000) return null;
  const range = x[n - 1] - x[0];
  if (!(range > 1e-19 * Math.max(1, Math.abs(x[0])))) return null;
  const poly = (cc, t) => { let r = 0; for (let i = cc.length - 1; i >= 0; i--) r = r * t + cc[i]; return r; };
  const nn2 = Math.floor(n / 2);
  let a;
  if (n === 3) a = [Math.SQRT1_2];
  else {
    const c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
    const c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
    const m = [];
    let summ2 = 0;
    for (let i = 1; i <= nn2; i++) {
      const v = jStat.normal.inv((i - 0.375) / (n + 0.25), 0, 1);
      m.push(v); summ2 += v * v;
    }
    summ2 *= 2;
    const ssumm2 = Math.sqrt(summ2), rsn = 1 / Math.sqrt(n);
    const a1 = poly(c1, rsn) - m[0] / ssumm2;
    a = m.slice();
    let i1, fac;
    if (n > 5) {
      i1 = 3;
      const a2 = -m[1] / ssumm2 + poly(c2, rsn);
      fac = Math.sqrt((summ2 - 2 * m[0] * m[0] - 2 * m[1] * m[1]) / (1 - 2 * a1 * a1 - 2 * a2 * a2));
      a[1] = a2;
    } else {
      i1 = 2;
      fac = Math.sqrt((summ2 - 2 * m[0] * m[0]) / (1 - 2 * a1 * a1));
    }
    a[0] = a1;
    for (let i = i1; i <= nn2; i++) a[i - 1] = -m[i - 1] / fac;
  }
  const mean = jStat.mean(x);
  let ss = 0, num = 0;
  x.forEach(v => { ss += (v - mean) * (v - mean); });
  for (let i = 0; i < nn2; i++) num += a[i] * (x[n - 1 - i] - x[i]);
  const W = Math.min(1, num * num / ss);

  let p;
  if (n === 3) p = Math.max(0, Math.min(1, (6 / Math.PI) * (Math.asin(Math.sqrt(W)) - Math.PI / 3)));
  else {
    let w1 = Math.log(1 - W), mu, s;
    if (n <= 11) {
      const gamma = -2.273 + 0.459 * n;
      if (w1 >= gamma) return { W, p: 0, n };
      w1 = -Math.log(gamma - w1);
      mu = poly([0.544, -0.39978, 0.025054, -6.714e-4], n);
      s = Math.exp(poly([1.3822, -0.77857, 0.062767, -0.0020322], n));
    } else {
      const ln = Math.log(n);
      mu = poly([-1.5861, -0.31082, -0.083751, 0.0038915], ln);
      s = Math.exp(poly([-0.4803, -0.082676, 0.0030302], ln));
    }
    p = normCdf(-(w1 - mu) / s);
  }
  return { W, p, n };
}

/* Brown–Forsythe (median-centred Levene) test for equal variances. */
function brownForsythe(groups) {
  const dev = groups.map(g => {
    const med = quantile([...g].sort((a, b) => a - b), 0.5);
    return g.map(v => Math.abs(v - med));
  });
  const av = anova(dev);
  return { F: av.F, df1: av.dfB, df2: av.dfW, p: av.p };
}

/* ============================================================
   COMPACT LETTER DISPLAY  (maximal cliques of the non-significance graph)
   ============================================================ */
function compactLetters(k, pairs, means, alpha = 0.05) {
  // edge if NOT significant (p >= alpha) → groups "the same". No self-loops.
  const adj = Array.from({ length: k }, () => new Set());
  pairs.forEach(pr => { if (!(pr.p < alpha)) { adj[pr.i].add(pr.j); adj[pr.j].add(pr.i); } });
  const cliques = [];
  bronKerbosch(new Set(), new Set([...Array(k).keys()]), new Set(), adj, cliques);
  // 'a' = clique with the highest average mean
  const avg = c => [...c].reduce((s, g) => s + means[g], 0) / c.size;
  cliques.sort((c1, c2) => avg(c2) - avg(c1));
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const labels = Array.from({ length: k }, () => []);
  cliques.forEach((c, idx) => { c.forEach(g => labels[g].push(alphabet[idx] || ("[" + (idx + 1) + "]"))); });
  return labels.map(ls => ls.sort().join(""));
}
function bronKerbosch(R, P, X, adj, out) {
  if (P.size === 0 && X.size === 0) { out.push(new Set(R)); return; }
  let pivot = -1, best = -1;
  new Set([...P, ...X]).forEach(u => { const c = [...P].filter(v => adj[u].has(v)).length; if (c > best) { best = c; pivot = u; } });
  [...P].filter(v => !adj[pivot].has(v)).forEach(v => {
    const Rn = new Set(R); Rn.add(v);
    bronKerbosch(Rn, new Set([...P].filter(u => adj[v].has(u))), new Set([...X].filter(u => adj[v].has(u))), adj, out);
    P.delete(v); X.add(v);
  });
}

/* ============================================================
   FORMATTING
   ============================================================ */
function starsFor(p) {
  if (p == null || !isFinite(p)) return "ns";
  if (p < 0.0001) return "****";
  if (p < 0.001) return "***";
  if (p < 0.01) return "**";
  if (p < 0.05) return "*";
  return "ns";
}
const fmt = (x, d = 4) => (x == null || !isFinite(x)) ? "—"
  : (Math.abs(x) >= 1e5 || (Math.abs(x) < 1e-4 && x !== 0) ? x.toExponential(2) : (+x.toFixed(d)).toString());
const fmtP = (p) => (p == null || !isFinite(p)) ? "—" : (p < 0.0001 ? "< 0.0001" : p.toFixed(4));

return {
  parseNum, parseDelimited, describe, quantile,
  tTest, pairedTTest, mannWhitney, wilcoxonSignedRank,
  anova, anovaPosthoc, kruskalWallis, dunnTest, adjustP,
  shapiroWilk, brownForsythe, compactLetters,
  ptukey, qtukey, pdunnett, qdunnett,
  starsFor, fmt, fmtP,
};
});
