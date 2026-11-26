// ============================================================
// Pipe Yard Relocation Optimizer — app.js
// ============================================================


// ============================================================
// SECTION 1: SEEDED PRNG
// ============================================================

function makeRng(seed) {
  let s = seed >>> 0;
  return function nextRandom() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function randomChoice(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

console.log("✅ PRNG module loaded");


// ============================================================
// SECTION 2: RULES & PLACEMENT
// ============================================================

function canPlace(stack, pipe, rules) {
  if (stack.length >= rules.H) return false;
  if (stack.length === 0) return true;
  if (!rules.diameterRule) return true;
  const top = stack[stack.length - 1];
  return top.diameter === pipe.diameter;
}

function defaultRules(overrides) {
  return Object.assign({ H: 4, diameterRule: false }, overrides || {});
}

console.log("✅ Rules module loaded");


// ============================================================
// SECTION 3: PIPE GENERATION
// ============================================================

const DIAMETERS = ['5"', '7"', '9-5/8"'];
const GRADES = ['L80', 'P110'];

function generatePipes(seed, totalPipes) {
  const rng = makeRng(seed);
  const pipes = [];

  for (let i = 0; i < totalPipes; i++) {
    pipes.push({
      id: 'lot-' + (i + 1),
      diameter: randomChoice(rng, DIAMETERS),
      grade: randomChoice(rng, GRADES),
      pickupOrder: i + 1
    });
  }

  for (let i = pipes.length - 1; i > 0; i--) {
    const j = randomInt(rng, 0, i);
    const a = pipes[i].pickupOrder;
    const b = pipes[j].pickupOrder;
    pipes[i].pickupOrder = b;
    pipes[j].pickupOrder = a;
  }

  return pipes;
}

console.log("✅ Pipe generator loaded");


// ============================================================
// SECTION 4: SCENARIO GENERATION
// ============================================================

const DEFAULT_N = 8;
const DEFAULT_H = 4;
const DEFAULT_DIAMETER_RULE = false;
const DEFAULT_SHUFFLE_STEPS = 20;
const DEFAULT_MAX_ATTEMPTS = 50;

function createDefaultScenario(seed) {
  return createScenario(seed, DEFAULT_N, DEFAULT_H, DEFAULT_DIAMETER_RULE, {
    shuffleSteps: DEFAULT_SHUFFLE_STEPS
  });
}

function createScenario(seed, N, H, diameterRule, options) {
  const opts = options || {};
  const maxAttempts = opts.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const shuffleSteps = opts.shuffleSteps || DEFAULT_SHUFFLE_STEPS;
  const rules = defaultRules({ H: H, diameterRule: diameterRule });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptSeed = seed + attempt;
    const scenario = buildScenario(attemptSeed, N, H, rules, shuffleSteps);
    if (!scenario) continue;

    const test = solveNaive(scenario);
    if (test.status === "solved") {
      scenario.attempts = attempt + 1;
      return scenario;
    }
  }

  return null;
}

function buildScenario(seed, N, H, rules, shuffleSteps) {
  const rng = makeRng(seed);
  const minPipes = Math.ceil(N * H * 0.6);
  const maxPipes = N * H;
  const totalPipes = randomInt(rng, minPipes, maxPipes);

  const pipes = generatePipes(seed, totalPipes);
  const buildOrder = pipes.slice().sort((a, b) => b.pickupOrder - a.pickupOrder);

  const stacks = Array.from({ length: N }, () => []);

  for (const pipe of buildOrder) {
    const legalIdx = [];
    for (let i = 0; i < N; i++) {
      if (canPlace(stacks[i], pipe, rules)) legalIdx.push(i);
    }
    if (legalIdx.length === 0) return null;
    const chosen = legalIdx[randomInt(rng, 0, legalIdx.length - 1)];
    stacks[chosen].push(pipe);
  }

  for (let step = 0; step < shuffleSteps; step++) {
    shuffleOnce(stacks, rules, rng);
  }

  return { seed, N, H, rules, stacks, totalPipes };
}

function shuffleOnce(stacks, rules, rng) {
  if (stacks.length < 2) return;
  const i = randomInt(rng, 0, stacks.length - 1);
  const j = randomInt(rng, 0, stacks.length - 1);
  if (i === j) return;
  const si = stacks[i];
  const sj = stacks[j];
  if (si.length === 0 || sj.length === 0) return;
  const pi = si[si.length - 1];
  const pj = sj[sj.length - 1];
  si.pop();
  sj.pop();
  const ok1 = canPlace(sj, pi, rules);
  const ok2 = canPlace(si, pj, rules);
  if (ok1 && ok2) {
    si.push(pj);
    sj.push(pi);
  } else {
    si.push(pi);
    sj.push(pj);
  }
}

console.log("✅ Scenario generator loaded");


// ============================================================
// SECTION 5: MOVE & RETRIEVE
// ============================================================

function cloneState(state) {
  return {
    stacks: state.stacks.map(s => s.slice()),
    nextNeeded: state.nextNeeded
  };
}

function applyMove(state, fromIdx, toIdx, rules) {
  if (fromIdx === toIdx) return null;
  if (fromIdx < 0 || fromIdx >= state.stacks.length) return null;
  if (toIdx < 0 || toIdx >= state.stacks.length) return null;

  const fromStack = state.stacks[fromIdx];
  const toStack = state.stacks[toIdx];
  if (fromStack.length === 0) return null;

  const pipe = fromStack[fromStack.length - 1];
  if (!canPlace(toStack, pipe, rules)) return null;

  const next = cloneState(state);
  next.stacks[fromIdx].pop();
  next.stacks[toIdx].push(pipe);
  return next;
}

function autoRetrieve(state) {
  const next = cloneState(state);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < next.stacks.length; i++) {
      const stack = next.stacks[i];
      if (stack.length === 0) continue;
      const top = stack[stack.length - 1];
      if (top.pickupOrder === next.nextNeeded) {
        stack.pop();
        next.nextNeeded += 1;
        changed = true;
      }
    }
  }
  return next;
}

function initialState(scenario) {
  return {
    stacks: scenario.stacks.map(s => s.slice()),
    nextNeeded: 1
  };
}

function isSolved(state) {
  return state.stacks.every(s => s.length === 0);
}

console.log("✅ Move & retrieve loaded");


// ============================================================
// SECTION 6: NAIVE SOLVER
// ============================================================

function solveNaive(scenario) {
  const rules = scenario.rules;
  let state = initialState(scenario);
  const moves = [];
  let safety = 0;
  const SAFETY_LIMIT = 10000;

  while (!isSolved(state)) {
    safety++;
    if (safety > SAFETY_LIMIT) {
      return { status: "limit reached", moves, relocations: moves.length };
    }

    const afterRetrieve = autoRetrieve(state);

    if (afterRetrieve.nextNeeded === state.nextNeeded) {
      const target = findNextNeeded(state);
      if (!target) {
        return { status: "infeasible", moves, relocations: moves.length };
      }

      const { stackIdx } = target;
      const blockerStack = state.stacks[stackIdx];
      const blocker = blockerStack[blockerStack.length - 1];

      const destIdx = findNearestLegalStack(state, stackIdx, blocker, rules);
      if (destIdx === -1) {
        return { status: "infeasible", moves, relocations: moves.length };
      }

      const newState = applyMove(state, stackIdx, destIdx, rules);
      if (!newState) {
        return { status: "infeasible", moves, relocations: moves.length };
      }

      moves.push({ from: stackIdx, to: destIdx, pipeId: blocker.id });
      state = newState;
    } else {
      state = afterRetrieve;
    }
  }

  return { status: "solved", moves, relocations: moves.length };
}

function findNextNeeded(state) {
  for (let i = 0; i < state.stacks.length; i++) {
    const stack = state.stacks[i];
    for (let j = stack.length - 1; j >= 0; j--) {
      if (stack[j].pickupOrder === state.nextNeeded) {
        return { stackIdx: i, depth: stack.length - 1 - j };
      }
    }
  }
  return null;
}

function findNearestLegalStack(state, fromIdx, pipe, rules) {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < state.stacks.length; i++) {
    if (i === fromIdx) continue;
    if (!canPlace(state.stacks[i], pipe, rules)) continue;
    const dist = Math.abs(i - fromIdx);
    if (dist < bestDist || (dist === bestDist && i < best)) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

console.log("✅ Naive solver loaded");


// ============================================================
// SECTION 7: HEURISTIC SOLVER
// ============================================================

function solveHeuristic(scenario) {
  const rules = scenario.rules;
  let state = initialState(scenario);
  const moves = [];
  let safety = 0;
  const SAFETY_LIMIT = 10000;

  while (!isSolved(state)) {
    safety++;
    if (safety > SAFETY_LIMIT) {
      return { status: "limit reached", moves, relocations: moves.length };
    }

    const afterRetrieve = autoRetrieve(state);

    if (afterRetrieve.nextNeeded === state.nextNeeded) {
      const target = findNextNeeded(state);
      if (!target) {
        return { status: "infeasible", moves, relocations: moves.length };
      }

      const { stackIdx } = target;
      const blockerStack = state.stacks[stackIdx];
      const blocker = blockerStack[blockerStack.length - 1];

      const destIdx = findHeuristicStack(state, stackIdx, blocker, rules);
      if (destIdx === -1) {
        return { status: "infeasible", moves, relocations: moves.length };
      }

      const newState = applyMove(state, stackIdx, destIdx, rules);
      if (!newState) {
        return { status: "infeasible", moves, relocations: moves.length };
      }

      moves.push({ from: stackIdx, to: destIdx, pipeId: blocker.id });
      state = newState;
    } else {
      state = afterRetrieve;
    }
  }

  return { status: "solved", moves, relocations: moves.length };
}

function findHeuristicStack(state, fromIdx, pipe, rules) {
  let bestNonEmpty = -1;
  let bestTopOrder = -Infinity;
  let bestEmpty = -1;

  for (let i = 0; i < state.stacks.length; i++) {
    if (i === fromIdx) continue;
    if (!canPlace(state.stacks[i], pipe, rules)) continue;

    const stack = state.stacks[i];
    if (stack.length === 0) {
      if (bestEmpty === -1 || i < bestEmpty) bestEmpty = i;
      continue;
    }

    const topOrder = stack[stack.length - 1].pickupOrder;
    if (topOrder > bestTopOrder ||
        (topOrder === bestTopOrder && (bestNonEmpty === -1 || i < bestNonEmpty))) {
      bestNonEmpty = i;
      bestTopOrder = topOrder;
    }
  }

  return bestNonEmpty !== -1 ? bestNonEmpty : bestEmpty;
}

console.log("✅ Heuristic solver loaded");


// ============================================================
// SECTION 8: OPTIMAL SOLVER (BFS)
// ============================================================

function solveOptimal(scenario, options) {
  const opts = options || {};
  const maxStates = opts.maxStates || 200000;
  const timeCapMs = opts.timeCapMs || 3000;

  const rules = scenario.rules;
  const startTime = Date.now();
  const start = initialState(scenario);

  const startRetrieved = autoRetrieve(start);
  if (isSolved(startRetrieved)) {
    return { status: "solved", moves: [], relocations: 0 };
  }

  let currentLevel = [{ state: start, moves: [] }];
  const visited = new Set();
  visited.add(canonicalKey(start));

  let explored = 0;

  while (currentLevel.length > 0) {
    const nextLevel = [];

    for (const { state, moves } of currentLevel) {
      explored++;
      if (explored > maxStates) return { status: "limit reached", moves: [], relocations: 0 };
      if (Date.now() - startTime > timeCapMs) return { status: "limit reached", moves: [], relocations: 0 };

      const successors = generateSuccessors(state, rules);
      for (const { nextState, move } of successors) {
        const key = canonicalKey(nextState);
        if (visited.has(key)) continue;
        visited.add(key);

        const nextMoves = move ? moves.concat([move]) : moves;
        if (isSolved(nextState)) {
          return { status: "solved", moves: nextMoves, relocations: nextMoves.length };
        }
        nextLevel.push({ state: nextState, moves: nextMoves });
      }
    }

    currentLevel = nextLevel;
  }

  return { status: "infeasible", moves: [], relocations: 0 };
}

function generateSuccessors(state, rules) {
  const afterRetrieve = autoRetrieve(state);

  if (afterRetrieve.nextNeeded !== state.nextNeeded) {
    return generateSuccessors(afterRetrieve, rules);
  }

  const successors = [];
  for (let from = 0; from < state.stacks.length; from++) {
    if (state.stacks[from].length === 0) continue;
    const blocker = state.stacks[from][state.stacks[from].length - 1];

    for (let to = 0; to < state.stacks.length; to++) {
      if (to === from) continue;
      if (!canPlace(state.stacks[to], blocker, rules)) continue;

      const moved = applyMove(state, from, to, rules);
      if (!moved) continue;

      const finalState = autoRetrieve(moved);
      successors.push({
        nextState: finalState,
        move: { from, to, pipeId: blocker.id }
      });
    }
  }
  return successors;
}

function canonicalKey(state) {
  const stackKeys = state.stacks.map(s =>
    s.map(p => p.pickupOrder).join(',')
  );
  stackKeys.sort();
  return stackKeys.join('|') + '#' + state.nextNeeded;
}

function isOptimalEligible(scenario) {
  const total = scenario.stacks.reduce((s, st) => s + st.length, 0);
  if (total > 8) return false;
  if (scenario.N > 4) return false;
  if (scenario.H > 3) return false;
  return true;
}

console.log("✅ Optimal solver loaded");


// ============================================================
// SECTION 9: MAIN BENCHMARK
// ============================================================

function runBenchmarkMain(options) {
  const opts = options || {};
  const count = opts.count || 1000;
  const chunkSize = opts.chunkSize || 50;
  const onProgress = opts.onProgress || function () {};

  return new Promise((resolve) => {
    const naiveResults = [];
    const heuristicResults = [];
    const heuristicWorse = [];
    let rejected = 0;
    let i = 0;

    function processChunk() {
      const chunkEnd = Math.min(i + chunkSize, count);

      for (; i < chunkEnd; i++) {
        const scenario = createDefaultScenario(i);
        if (!scenario) { rejected++; continue; }

        const naive = solveNaive(scenario);
        const heur = solveHeuristic(scenario);

        if (naive.status !== "solved" || heur.status !== "solved") {
          rejected++;
          continue;
        }

        naiveResults.push(naive.relocations);
        heuristicResults.push(heur.relocations);

        if (heur.relocations > naive.relocations) {
          heuristicWorse.push({
            seed: i,
            naive: naive.relocations,
            heuristic: heur.relocations
          });
        }
      }

      onProgress(i, count);

      if (i < count) {
        setTimeout(processChunk, 0);
      } else {
        resolve({
          total: count,
          solved: naiveResults.length,
          rejected,
          naive: summarize(naiveResults),
          heuristic: summarize(heuristicResults),
          reductionPct: computeReduction(naiveResults, heuristicResults),
          heuristicWorse
        });
      }
    }

    processChunk();
  });
}

function summarize(arr) {
  if (arr.length === 0) return { avg: 0, median: 0, min: 0, max: 0, total: 0 };
  const sorted = arr.slice().sort((a, b) => a - b);
  const total = arr.reduce((s, x) => s + x, 0);
  const avg = total / arr.length;
  const median = arr.length % 2 === 1
    ? sorted[Math.floor(arr.length / 2)]
    : (sorted[arr.length / 2 - 1] + sorted[arr.length / 2]) / 2;
  return { avg, median, min: sorted[0], max: sorted[sorted.length - 1], total };
}

function computeReduction(naiveArr, heurArr) {
  if (naiveArr.length === 0) return 0;
  const nAvg = naiveArr.reduce((s, x) => s + x, 0) / naiveArr.length;
  const hAvg = heurArr.reduce((s, x) => s + x, 0) / heurArr.length;
  if (nAvg === 0) return 0;
  return ((nAvg - hAvg) / nAvg) * 100;
}

console.log("✅ Main benchmark loaded");


// ============================================================
// SECTION 10: SMALL BENCHMARK (with Optimal)
// ============================================================

function runBenchmarkSmall(options) {
  const opts = options || {};
  const count = opts.count || 200;
  const chunkSize = opts.chunkSize || 10;
  const onProgress = opts.onProgress || function () {};

  const SMALL_N = 4;
  const SMALL_H = 3;
  const SMALL_SHUFFLE = 10;

  return new Promise((resolve) => {
    const naiveResults = [];
    const heuristicResults = [];
    const optimalResults = [];
    const heuristicWorse = [];
    const paired = [];
    let optimalLimitReached = 0;
    let optimalWorse = 0;
    let rejected = 0;
    let i = 0;

    function processChunk() {
      const chunkEnd = Math.min(i + chunkSize, count);

      for (; i < chunkEnd; i++) {
        const scenario = createScenario(i, SMALL_N, SMALL_H, false, {
          shuffleSteps: SMALL_SHUFFLE
        });
        if (!scenario) { rejected++; continue; }

        const naive = solveNaive(scenario);
        const heur = solveHeuristic(scenario);

        if (naive.status !== "solved" || heur.status !== "solved") {
          rejected++;
          continue;
        }

        naiveResults.push(naive.relocations);
        heuristicResults.push(heur.relocations);

        if (heur.relocations > naive.relocations) {
          heuristicWorse.push({ seed: i, naive: naive.relocations, heuristic: heur.relocations });
        }

        const opt = solveOptimal(scenario);
        if (opt.status === "solved") {
          optimalResults.push(opt.relocations);
          paired.push({ heur: heur.relocations, opt: opt.relocations });
          if (opt.relocations > heur.relocations) optimalWorse++;
        } else if (opt.status === "limit reached") {
          optimalLimitReached++;
        } else {
          rejected++;
        }
      }

      onProgress(i, count);

      if (i < count) {
        setTimeout(processChunk, 0);
      } else {
        let gapSum = 0, gapCount = 0;
        for (const p of paired) {
          if (p.opt === 0) continue;
          gapSum += (p.heur - p.opt) / p.opt;
          gapCount++;
        }
        const gapPct = gapCount > 0 ? (gapSum / gapCount) * 100 : 0;

        resolve({
          total: count,
          solved: naiveResults.length,
          rejected,
          naive: summarize(naiveResults),
          heuristic: summarize(heuristicResults),
          optimal: summarize(optimalResults),
          gapToOptimalPct: gapPct,
          limitReachedCount: optimalLimitReached,
          pairedCount: paired.length,
          heuristicWorseThanNaive: heuristicWorse,
          optimalWorseThanHeuristic: optimalWorse
        });
      }
    }

    processChunk();
  });
}

console.log("✅ Small benchmark loaded");


// ============================================================
// SECTION 11: SELF-CHECK
// ============================================================

function runSelfCheck(options) {
  const opts = options || {};
  const count = opts.count || 100;

  console.log("=== runSelfCheck() starting ===");
  console.log(`Testing ${count} small scenarios...\n`);

  let pass = true;
  const failures = [];
  let heurWorseThanNaive = 0;
  let optWorseThanHeur = 0;
  let optWorseThanNaive = 0;
  let illegalMoveCount = 0;
  let solvedCount = 0;

  for (let seed = 0; seed < count; seed++) {
    const scenario = createScenario(seed, 4, 3, false, { shuffleSteps: 10 });
    if (!scenario) continue;

    const naive = solveNaive(scenario);
    const heur = solveHeuristic(scenario);
    const opt = solveOptimal(scenario);

    for (const { name, result } of [
      { name: "naive", result: naive },
      { name: "heuristic", result: heur },
      { name: "optimal", result: opt }
    ]) {
      if (result.status !== "solved") continue;
      const replay = replayAndVerify(scenario, result.moves);
      if (!replay.ok) {
        pass = false;
        illegalMoveCount++;
        failures.push({ seed, solver: name, error: replay.error });
      }
    }

    if (opt.status === "solved") {
      solvedCount++;
      if (heur.status === "solved" && opt.relocations > heur.relocations) {
        pass = false;
        optWorseThanHeur++;
        failures.push({ seed, error: `Optimal (${opt.relocations}) > Heuristic (${heur.relocations})` });
      }
      if (naive.status === "solved" && opt.relocations > naive.relocations) {
        pass = false;
        optWorseThanNaive++;
        failures.push({ seed, error: `Optimal (${opt.relocations}) > Naive (${naive.relocations})` });
      }
    }

    if (heur.status === "solved" && naive.status === "solved" && heur.relocations > naive.relocations) {
      heurWorseThanNaive++;
    }
  }

  console.log("=== Self-Check Results ===");
  console.log(`Scenarios tested:       ${count}`);
  console.log(`Optimal solved:         ${solvedCount}`);
  console.log(`Illegal moves found:    ${illegalMoveCount}`);
  console.log(`Optimal > Heuristic:    ${optWorseThanHeur} (must be 0)`);
  console.log(`Optimal > Naive:        ${optWorseThanNaive} (must be 0)`);
  console.log(`Heuristic > Naive:      ${heurWorseThanNaive} (report only)`);
  console.log("");

  if (pass) {
    console.log("✅ SELF-CHECK PASSED");
  } else {
    console.log("❌ SELF-CHECK FAILED");
    failures.slice(0, 10).forEach(f => console.log("  ", f));
  }

  return { pass, failures };
}

function replayAndVerify(scenario, moves) {
  let state = autoRetrieve(initialState(scenario));

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const nextState = applyMove(state, m.from, m.to, scenario.rules);
    if (!nextState) {
      return { ok: false, error: `Move #${i + 1} is illegal` };
    }
    state = autoRetrieve(nextState);
  }

  if (!isSolved(state)) {
    return { ok: false, error: "Scenario not solved after replaying all moves" };
  }

  return { ok: true };
}

console.log("✅ Self-check loaded");


// ============================================================
// SECTION 12: SVG BAR CHART
// ============================================================

function renderBarChart(container, data, options) {
  const opts = options || {};
  const width = opts.width || 600;
  const height = opts.height || 300;
  const padding = { top: 40, right: 20, bottom: 60, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxValue = Math.max(1, ...data.map(d => d.value));
  const barGap = 20;
  const barWidth = (chartW - barGap * (data.length - 1)) / data.length;

  const ticks = 4;
  let yAxis = "";
  for (let i = 0; i <= ticks; i++) {
    const y = padding.top + chartH - (chartH * i / ticks);
    const value = (maxValue * i / ticks).toFixed(1);
    yAxis += `<line x1="${padding.left}" y1="${y}" x2="${padding.left + chartW}" y2="${y}" stroke="#334155" stroke-width="1" />`;
    yAxis += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" fill="#94a3b8" font-size="11">${value}</text>`;
  }

  let bars = "";
  data.forEach((d, i) => {
    const barH = (d.value / maxValue) * chartH;
    const x = padding.left + i * (barWidth + barGap);
    const y = padding.top + chartH - barH;
    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${d.color}" rx="4" />`;
    bars += `<text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" fill="#e2e8f0" font-size="13" font-weight="600">${d.value.toFixed(2)}</text>`;
    bars += `<text x="${x + barWidth / 2}" y="${padding.top + chartH + 20}" text-anchor="middle" fill="#cbd5e1" font-size="12">${d.label}</text>`;
  });

  const title = opts.title || "Average Relocations";
  const svg = `
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}">
      <text x="${width / 2}" y="24" text-anchor="middle" fill="#e2e8f0" font-size="14" font-weight="600">${title}</text>
      ${yAxis}
      ${bars}
    </svg>
  `;

  if (container) container.innerHTML = svg;
  return svg;
}

console.log("✅ SVG bar chart loaded");


// ============================================================
// SECTION 13: I18N & THEME
// ============================================================

const I18N = {
  en: {
    skipToContent: "Skip to content",
    toggleTheme: "Toggle theme",
    switchLang: "Switch language",
    heroTitle: "Pipe Yard Relocation Optimizer",
    heroLead: "Reduce unnecessary relocations in oilfield tubulars laydown yards. Compare naive, heuristic, and optimal solvers on real scenarios.",
    metricLabel: "Headline Metric",
    metricPending: "—",
    metricSub: "Run the benchmark to see results",
    demoTitle: "Interactive Demo",
    demoDesc: "A generated scenario (seed 42). Pipes are colored by diameter; the gold-outlined pipe is the next needed.",
    benchmarkTitle: "Benchmark",
    benchmarkPlaceholder: "Coming soon: run 1000 scenarios, compare solvers, and view results.",
    caseStudyTitle: "Case Study",
    caseStudyPlaceholder: "Coming soon: problem, approach, results, and limitations.",
    footerGithub: "GitHub",
    footerBuilt: "Built by Saif"
  },
  ar: {
    skipToContent: "تجاوز إلى المحتوى",
    toggleTheme: "تبديل المظهر",
    switchLang: "تبديل اللغة",
    heroTitle: "محسّن نقل الأنابيب",
    heroLead: "قلّل عمليات النقل غير الضرورية في ساحات الأنابيب النفطية. قارن بين الحلول الساذجة والاستدلالية والمثلى على سيناريوهات حقيقية.",
    metricLabel: "المؤشر الرئيسي",
    metricPending: "—",
    metricSub: "شغّل القياس لرؤية النتائج",
    demoTitle: "العرض التفاعلي",
    demoDesc: "سيناريو مولّد (seed 42). الأنابيب ملونة حسب القطر؛ الأنبوب ذو الإطار الذهبي هو التالي المطلوب.",
    benchmarkTitle: "القياس",
    benchmarkPlaceholder: "قريباً: تشغيل 1000 سيناريو، مقارنة الحلول، وعرض النتائج.",
    caseStudyTitle: "دراسة الحالة",
    caseStudyPlaceholder: "قريباً: المشكلة، المنهج، النتائج، والقيود.",
    footerGithub: "GitHub",
    footerBuilt: "صنع بواسطة سيف"
  }
};

let currentLang = "en";

function applyLanguage(lang) {
  currentLang = lang;
  const dict = I18N[lang];
  if (!dict) return;

  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";

  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (dict[key]) el.textContent = dict[key];
  });

  document.querySelectorAll("[data-i18n-aria]").forEach(el => {
    const key = el.getAttribute("data-i18n-aria");
    if (dict[key]) el.setAttribute("aria-label", dict[key]);
  });

  const toggle = document.getElementById("langToggle");
  if (toggle) toggle.textContent = lang === "en" ? "العربية" : "English";

  localStorage.setItem("lang", lang);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const icon = document.getElementById("themeIcon");
  if (icon) icon.textContent = theme === "dark" ? "🌙" : "☀️";
  localStorage.setItem("theme", theme);
}

console.log("✅ i18n & theme loaded");


// ============================================================
// SECTION 14: YARD VISUALIZATION (SVG)
// ============================================================

const PIPE_COLORS = {
  '5"': '#3b82f6',
  '7"': '#f59e0b',
  '9-5/8"': '#22c55e'
};

function renderYard(container, state, options) {
  const opts = options || {};
  const N = state.stacks.length;
  const H = opts.H || 4;

  const pipeW = 60;
  const pipeH = 32;
  const gapX = 16;
  const gapY = 4;
  const padding = 20;
  const width = padding * 2 + N * pipeW + (N - 1) * gapX;
  const height = padding * 2 + H * (pipeH + gapY) + 8;

  let nextNeededPos = null;
  for (let i = 0; i < state.stacks.length; i++) {
    const stack = state.stacks[i];
    for (let j = 0; j < stack.length; j++) {
      if (stack[j].pickupOrder === state.nextNeeded) {
        nextNeededPos = { stackIdx: i, depth: j };
      }
    }
  }

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Yard visualization" class="yard-svg">`;

  for (let i = 0; i < N; i++) {
    const stack = state.stacks[i];
    const x = padding + i * (pipeW + gapX);
    const baseY = padding + H * (pipeH + gapY);

    svg += `<g data-stack-idx="${i}" style="cursor: pointer;">`;
    svg += `<rect x="${x}" y="${padding}" width="${pipeW}" height="${baseY - padding + 20}" fill="transparent" />`;
    svg += `<line x1="${x}" y1="${baseY}" x2="${x + pipeW}" y2="${baseY}" stroke="var(--border)" stroke-width="2" />`;
    svg += `<text x="${x + pipeW / 2}" y="${baseY + 18}" text-anchor="middle" fill="var(--text-muted)" font-size="11">S${i}</text>`;

    for (let j = 0; j < stack.length; j++) {
      const pipe = stack[j];
      const y = baseY - (j + 1) * (pipeH + gapY) + gapY;
      const isNext = nextNeededPos && nextNeededPos.stackIdx === i && nextNeededPos.depth === j;
      const fill = PIPE_COLORS[pipe.diameter] || '#64748b';
      const stroke = isNext ? '#fbbf24' : 'rgba(0,0,0,0.3)';
      const strokeW = isNext ? 3 : 1;

      svg += `<rect x="${x}" y="${y}" width="${pipeW}" height="${pipeH}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" />`;
      svg += `<text x="${x + pipeW / 2}" y="${y + pipeH / 2 + 4}" text-anchor="middle" fill="white" font-size="13" font-weight="600">${pipe.pickupOrder}</text>`;
    }
    svg += `</g>`;
  }

  svg += `</svg>`;

  if (container) container.innerHTML = svg;
  return svg;
}

function renderLegend(container) {
  if (!container) return;
  const items = [
    { label: '5"', color: PIPE_COLORS['5"'] },
    { label: '7"', color: PIPE_COLORS['7"'] },
    { label: '9-5/8"', color: PIPE_COLORS['9-5/8"'] },
    { label: 'Next', color: '#fbbf24', isOutline: true }
  ];

  const html = `<div class="yard-legend">` + items.map(item => {
    const swatch = item.isOutline
      ? `<span class="legend-swatch" style="border: 2px solid ${item.color}; background: transparent;"></span>`
      : `<span class="legend-swatch" style="background: ${item.color};"></span>`;
    return `<span class="legend-item">${swatch}${item.label}</span>`;
  }).join('') + `</div>`;

  container.innerHTML = html;
}

console.log("✅ Yard visualization loaded");


// ============================================================
// SECTION 15: MANUAL MODE
// ============================================================

let demoState = {
  scenario: null,
  currentState: null,
  selectedStack: null,
  relocations: 0
};

function initManualMode() {
  const scenario = createDefaultScenario(42);
  demoState.scenario = scenario;
  demoState.currentState = initialState(scenario);
  demoState.selectedStack = null;
  demoState.relocations = 0;

  demoState.currentState = autoRetrieve(demoState.currentState);

  const container = document.getElementById("yardContainer");
  if (container && !container.dataset.manualBound) {
    container.dataset.manualBound = "1";
    container.addEventListener("click", (e) => {
      const stackEl = e.target.closest("[data-stack-idx]");
      if (!stackEl) return;
      const idx = parseInt(stackEl.getAttribute("data-stack-idx"), 10);
      handleStackClick(idx);
    });
  }

  const bind = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", handler);
  };

  bind("btnReset", resetDemo);
  bind("btnNewScenario", newScenario);
  bind("btnSolveNaive", () => autoSolve("naive"));
  bind("btnSolveHeuristic", () => autoSolve("heuristic"));
  bind("btnSolveOptimal", () => autoSolve("optimal"));

  renderCurrentState();
  renderLegend(document.getElementById("yardLegend"));
}

function renderCurrentState() {
  const container = document.getElementById("yardContainer");
  renderYard(container, demoState.currentState, { H: demoState.scenario.H });
  updateStatus();
  const countEl = document.getElementById("relocationCount");
  if (countEl) countEl.textContent = demoState.relocations;
}

function updateStatus() {
  const statusEl = document.getElementById("yardStatus");
  if (!statusEl) return;

  if (isSolved(demoState.currentState)) {
    statusEl.textContent = "🎉 Solved! All pipes retrieved.";
    statusEl.className = "yard-status success";
    return;
  }

  if (demoState.selectedStack !== null) {
    statusEl.textContent = `Selected stack S${demoState.selectedStack} (top pipe: #${getTopPickupOrder(demoState.selectedStack)}). Click another stack to place it.`;
    statusEl.className = "yard-status";
  } else {
    statusEl.textContent = `Next needed: pipe #${demoState.currentState.nextNeeded}. Click a stack to pick up its top pipe.`;
    statusEl.className = "yard-status";
  }
}

function getTopPickupOrder(stackIdx) {
  const stack = demoState.currentState.stacks[stackIdx];
  if (!stack || stack.length === 0) return "—";
  return stack[stack.length - 1].pickupOrder;
}

function handleStackClick(idx) {
  const state = demoState.currentState;
  const stack = state.stacks[idx];

  if (demoState.selectedStack === null) {
    if (stack.length === 0) {
      showError("Stack S" + idx + " is empty. Nothing to pick up.");
      return;
    }
    demoState.selectedStack = idx;
    updateStatus();
    return;
  }

  if (demoState.selectedStack === idx) {
    demoState.selectedStack = null;
    updateStatus();
    return;
  }

  const fromIdx = demoState.selectedStack;
  const toIdx = idx;
  const newState = applyMove(state, fromIdx, toIdx, demoState.scenario.rules);

  if (!newState) {
    showError(`Illegal move: cannot place pipe on stack S${toIdx}.`);
    return;
  }

  demoState.currentState = autoRetrieve(newState);
  demoState.relocations++;
  demoState.selectedStack = null;

  renderCurrentState();
}

function showError(msg) {
  const statusEl = document.getElementById("yardStatus");
  if (statusEl) {
    statusEl.textContent = "❌ " + msg;
    statusEl.className = "yard-status error";
  }
  demoState.selectedStack = null;
}

function resetDemo() {
  demoState.currentState = autoRetrieve(initialState(demoState.scenario));
  demoState.selectedStack = null;
  demoState.relocations = 0;
  renderCurrentState();
}

function newScenario() {
  const newSeed = Math.floor(Math.random() * 100000);
  const scenario = createDefaultScenario(newSeed);
  if (!scenario) {
    showError("Could not generate scenario. Try again.");
    return;
  }
  demoState.scenario = scenario;
  demoState.currentState = autoRetrieve(initialState(scenario));
  demoState.selectedStack = null;
  demoState.relocations = 0;
  renderCurrentState();
}

function autoSolve(method) {
  const scenario = demoState.scenario;
  let result;
  if (method === "naive") result = solveNaive(scenario);
  else if (method === "heuristic") result = solveHeuristic(scenario);
  else result = solveOptimal(scenario);

  if (result.status !== "solved") {
    showError(`Solver returned: ${result.status}`);
    return;
  }

  let state = autoRetrieve(initialState(scenario));
  for (const m of result.moves) {
    state = applyMove(state, m.from, m.to, scenario.rules);
    state = autoRetrieve(state);
  }

  demoState.currentState = state;
  demoState.relocations = result.relocations;
  demoState.selectedStack = null;
  renderCurrentState();

  const statusEl = document.getElementById("yardStatus");
  if (statusEl) {
    statusEl.textContent = `✅ ${method} solved with ${result.relocations} relocations.`;
    statusEl.className = "yard-status success";
  }
}

console.log("✅ Manual mode loaded");


// ============================================================
// INIT
// ============================================================

function initI18nAndTheme() {
  const savedLang = localStorage.getItem("lang") || "en";
  const savedTheme = localStorage.getItem("theme") || "dark";

  applyLanguage(savedLang);
  applyTheme(savedTheme);

  const langToggle = document.getElementById("langToggle");
  if (langToggle) {
    langToggle.addEventListener("click", () => {
      applyLanguage(currentLang === "en" ? "ar" : "en");
    });
  }

  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      applyTheme(cur === "dark" ? "light" : "dark");
    });
  }

  initManualMode();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initI18nAndTheme);
} else {
  initI18nAndTheme();
}