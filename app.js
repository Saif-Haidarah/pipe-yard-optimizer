// ============================================================
// Pipe Yard Relocation Optimizer — app.js
// Section 1: Seeded PRNG
// Section 2: Rules & Placement
// Section 3: Scenario Generation (Part 1 — pipes only)
// ============================================================


// ============================================================
// SECTION 1: SEEDED PRNG
// ============================================================
// A deterministic pseudo-random number generator.
// Same seed → same sequence. This is what makes benchmarks
// reproducible: anyone with the same seed gets the same results.

function makeRng(seed) {
  // Force seed to be a 32-bit unsigned integer.
  let s = seed >>> 0;

  // Return a function that produces the next number in [0, 1).
  return function nextRandom() {
    // Linear Congruential Generator (LCG) constants:
    // These are the "Numerical Recipes" constants — well-known and tested.
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Helper: random integer in [min, max] (inclusive).
function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// Helper: random element from an array.
function randomChoice(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

console.log("✅ PRNG module loaded");


// ============================================================
// SECTION 2: RULES & PLACEMENT
// ============================================================
// canPlace is THE single source of truth for whether a pipe
// can be placed on a stack. Every solver and manual mode MUST
// use this function — never duplicate the logic.

function canPlace(stack, pipe, rules) {
  // Rule 1: stack must have free space.
  if (stack.length >= rules.H) return false;

  // Rule 2: empty stack always accepts (as long as it has space).
  if (stack.length === 0) return true;

  // Rule 3: diameter rule (only if enabled).
  if (!rules.diameterRule) return true;

  const top = stack[stack.length - 1];
  return top.diameter === pipe.diameter;
}

// Default rules — used when no rules are passed.
function defaultRules(overrides) {
  return Object.assign({ H: 4, diameterRule: false }, overrides || {});
}

console.log("✅ Rules module loaded");


// ============================================================
// SECTION 3: SCENARIO GENERATION (Part 1 — pipes only)
// ============================================================

const DIAMETERS = ['5"', '7"', '9-5/8"'];
const GRADES = ['L80', 'P110'];

// Generate a list of pipes with unique pickupOrder values.
// The list is NOT yet placed on stacks — that comes next.
function generatePipes(seed, totalPipes) {
  const rng = makeRng(seed);
  const pipes = [];

  for (let i = 0; i < totalPipes; i++) {
    pipes.push({
      id: 'lot-' + (i + 1),
      diameter: randomChoice(rng, DIAMETERS),
      grade: randomChoice(rng, GRADES),
      pickupOrder: i + 1  // 1 = needed first
    });
  }

  // Shuffle the assignment of pickupOrder to pipes,
  // so pickup order is NOT correlated with id.
  // Fisher-Yates shuffle using the same rng.
  for (let i = pipes.length - 1; i > 0; i--) {
    const j = randomInt(rng, 0, i);
    const a = pipes[i].pickupOrder;
    const b = pipes[j].pickupOrder;
    pipes[i].pickupOrder = b;
    pipes[j].pickupOrder = a;
  }

  return pipes;
}

console.log("✅ Scenario generator (part 1) loaded");
// ===== Full smoke test =====

// 1) canPlace basic checks
const rules = defaultRules();
console.log("empty accepts:", canPlace([], { diameter: '5"' }, rules));            // true
console.log("full rejects:", canPlace([{},{},{},{}], { diameter: '5"' }, rules)); // false

// 2) diameter rule ON
const strict = defaultRules({ diameterRule: true });
console.log("strict mismatch:", canPlace([{diameter:'5"'}], { diameter: '7"' }, strict)); // false
console.log("strict match:", canPlace([{diameter:'5"'}], { diameter: '5"' }, strict));   // true

// 3) generatePipes basic
const pipes = generatePipes(42, 6);
console.log("pipes count:", pipes.length);                                         // 6

// 4) pickupOrders are exactly 1..6
const orders = pipes.map(p => p.pickupOrder).sort((a,b) => a-b);
console.log("orders:", orders);                                                    // [1,2,3,4,5,6]

// 5) reproducibility
const pipes2 = generatePipes(42, 6);
console.log("reproducible:", JSON.stringify(pipes) === JSON.stringify(pipes2));    // true

// 6) full pipe dump (optional, for eyeballing)
console.log("sample pipes:", JSON.stringify(pipes, null, 2));


// ============================================================
// SECTION 4: SCENARIO GENERATION (v2 — with shuffle)
// ============================================================
// Strategy:
//   1. Build in reverse (guarantees solvability).
//   2. Shuffle some pipes between stacks (creates relocations).
//   3. Verify with solveNaive. If infeasible, retry with next seed.
//   4. Count rejected attempts (returned separately, not in averages).
//
// Tuned defaults (see benchmark notes in README):
//   N = 8, H = 4, shuffleSteps = 20  →  avgReloc ≈ 2.29, zeroPct ≈ 11%

const DEFAULT_N = 8;
const DEFAULT_H = 4;
const DEFAULT_DIAMETER_RULE = false;
const DEFAULT_SHUFFLE_STEPS = 20;
const DEFAULT_MAX_ATTEMPTS = 50;

// Main benchmark entry point — uses tuned defaults.
function createDefaultScenario(seed) {
  return createScenario(seed, DEFAULT_N, DEFAULT_H, DEFAULT_DIAMETER_RULE, {
    shuffleSteps: DEFAULT_SHUFFLE_STEPS
  });
}

// General entry point — allows overriding N, H, diameterRule, shuffleSteps.
// Returns null if all attempts failed (caller counts it as "rejected").
function createScenario(seed, N, H, diameterRule, options) {
  const opts = options || {};
  const maxAttempts = opts.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const shuffleSteps = opts.shuffleSteps || DEFAULT_SHUFFLE_STEPS;

  const rules = defaultRules({ H: H, diameterRule: diameterRule });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptSeed = seed + attempt;
    const scenario = buildScenario(attemptSeed, N, H, rules, shuffleSteps);
    if (!scenario) continue;

    // Verify solvability with the fastest solver (Naive).
    const test = solveNaive(scenario);
    if (test.status === "solved") {
      scenario.attempts = attempt + 1;  // how many tries it took
      return scenario;
    }
  }

  // All attempts failed (very unlikely for reasonable parameters).
  return null;
}

// Build one candidate: reverse-build, then shuffle.
function buildScenario(seed, N, H, rules, shuffleSteps) {
  const rng = makeRng(seed);

  const minPipes = Math.ceil(N * H * 0.6);
  const maxPipes = N * H;
  const totalPipes = randomInt(rng, minPipes, maxPipes);

  const pipes = generatePipes(seed, totalPipes);
  const buildOrder = pipes.slice().sort((a, b) => b.pickupOrder - a.pickupOrder);

  const stacks = Array.from({ length: N }, () => []);

  // Phase 1: reverse build (guarantees solvability).
  for (const pipe of buildOrder) {
    const legalIdx = [];
    for (let i = 0; i < N; i++) {
      if (canPlace(stacks[i], pipe, rules)) legalIdx.push(i);
    }
    if (legalIdx.length === 0) return null;
    const chosen = legalIdx[randomInt(rng, 0, legalIdx.length - 1)];
    stacks[chosen].push(pipe);
  }

  // Phase 2: shuffle — swap random pipes between random stacks.
  for (let step = 0; step < shuffleSteps; step++) {
    shuffleOnce(stacks, rules, rng);
  }

  return {
    seed: seed,
    N: N,
    H: H,
    rules: rules,
    stacks: stacks,
    totalPipes: totalPipes
  };
}

// One shuffle step: pick two stacks and try to swap their tops.
// Only swaps if BOTH new placements are legal (H + canPlace).
function shuffleOnce(stacks, rules, rng) {
  if (stacks.length < 2) return;

  const i = randomInt(rng, 0, stacks.length - 1);
  let j = randomInt(rng, 0, stacks.length - 1);
  if (i === j) return;

  const stackI = stacks[i];
  const stackJ = stacks[j];
  if (stackI.length === 0 || stackJ.length === 0) return;

  const pipeI = stackI[stackI.length - 1];
  const pipeJ = stackJ[stackJ.length - 1];

  // Temporarily pop both.
  stackI.pop();
  stackJ.pop();

  // Try to place pipeI on stackJ and pipeJ on stackI.
  const canIPlaceJ = canPlace(stackJ, pipeI, rules);
  const canJPlaceI = canPlace(stackI, pipeJ, rules);

  if (canIPlaceJ && canJPlaceI) {
    stackI.push(pipeJ);
    stackJ.push(pipeI);
  } else {
    // Revert.
    stackI.push(pipeI);
    stackJ.push(pipeJ);
  }
}

console.log("✅ Scenario generator (v2 with shuffle) loaded");


// ============================================================
// SECTION 5: MOVE & RETRIEVE
// ============================================================
// These are the ONLY two operations that change the yard state.
// Every solver and manual mode MUST use these — never mutate
// stacks directly.

// Deep-copy a state so we never mutate the original.
// (BFS relies on this: each branch must be independent.)
function cloneState(state) {
  return {
    stacks: state.stacks.map(s => s.slice()),
    nextNeeded: state.nextNeeded
  };
}

// Move the top pipe from `fromIdx` to `toIdx`.
// Returns a NEW state, or null if the move is illegal.
function applyMove(state, fromIdx, toIdx, rules) {
  // Validate indexes.
  if (fromIdx === toIdx) return null;
  if (fromIdx < 0 || fromIdx >= state.stacks.length) return null;
  if (toIdx < 0 || toIdx >= state.stacks.length) return null;

  const fromStack = state.stacks[fromIdx];
  const toStack = state.stacks[toIdx];

  // Source must have a pipe.
  if (fromStack.length === 0) return null;

  const pipe = fromStack[fromStack.length - 1];

  // Destination must accept the pipe.
  if (!canPlace(toStack, pipe, rules)) return null;

  // Build the new state (clone first — never mutate input).
  const next = cloneState(state);
  next.stacks[fromIdx].pop();       // remove from source
  next.stacks[toIdx].push(pipe);    // add to destination

  return next;
}

// Auto-retrieve: after any move, if the next-needed pipe is on top
// of any stack, remove it and advance nextNeeded. Repeat until
// nothing can be retrieved. Returns a NEW state.
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

// Build an initial state from a scenario.
function initialState(scenario) {
  return {
    stacks: scenario.stacks.map(s => s.slice()), // deep copy
    nextNeeded: 1
  };
}

// Check if all pipes have been retrieved.
function isSolved(state) {
  return state.stacks.every(s => s.length === 0);
}

console.log("✅ Move & retrieve module loaded");

// ============================================================
// SECTION 6: NAIVE SOLVER
// ============================================================
// Strategy: when the next-needed pipe is blocked, move each
// blocker to the NEAREST stack (by index distance) that accepts it.
// This is deliberately dumb — it gives us a baseline to beat.
//
// Returns: { status, moves, relocations }
//   status: "solved" | "infeasible" | "limit reached"
//   moves: array of { from, to, pipeId }
//   relocations: number of moves (retrievals are NOT counted)

function solveNaive(scenario) {
  const rules = scenario.rules;
  let state = initialState(scenario);
  const moves = [];
  let safety = 0;
  const SAFETY_LIMIT = 10000; // prevent infinite loops

  while (!isSolved(state)) {
    safety++;
    if (safety > SAFETY_LIMIT) {
      return { status: "limit reached", moves, relocations: moves.length };
    }

    // 1) Auto-retrieve whatever is available.
    const afterRetrieve = autoRetrieve(state);

    // If nothing changed, the next-needed pipe is blocked.
    if (afterRetrieve.nextNeeded === state.nextNeeded) {
      // 2) Find the next-needed pipe and the stack it's in.
      const target = findNextNeeded(state);
      if (!target) {
        // Should not happen if scenario is feasible.
        return { status: "infeasible", moves, relocations: moves.length };
      }

      const { stackIdx } = target;

      // 3) Find a legal target stack for the top blocker.
      const blockerStack = state.stacks[stackIdx];
      const blocker = blockerStack[blockerStack.length - 1];

      const destIdx = findNearestLegalStack(state, stackIdx, blocker, rules);
      if (destIdx === -1) {
        return { status: "infeasible", moves, relocations: moves.length };
      }

      // 4) Apply the move.
      const newState = applyMove(state, stackIdx, destIdx, rules);
      if (!newState) {
        return { status: "infeasible", moves, relocations: moves.length };
      }

      moves.push({ from: stackIdx, to: destIdx, pipeId: blocker.id });
      state = newState;
    } else {
      // Retrieval happened — state advanced.
      state = afterRetrieve;
    }
  }

  return { status: "solved", moves, relocations: moves.length };
}

// Find which stack has the next-needed pipe on top (or anywhere).
// Returns { stackIdx, depth } where depth = how many pipes are above it.
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

// Find the nearest stack (by |i - fromIdx|) that can accept `pipe`.
// Ties broken by lowest index. Returns -1 if none.
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
// Strategy: move each blocker to the stack whose TOP pipe has the
// LARGEST pickupOrder (i.e. the stack it "blocks" the least).
// Empty stacks are used only when no non-empty stack is legal.
// Ties broken by lowest index.
//
// Same interface as solveNaive: { status, moves, relocations }.

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

// Find the best stack for `pipe` using the min-max heuristic:
// prefer non-empty stacks whose top has the largest pickupOrder.
// Empty stacks only if no non-empty is legal. Ties by lowest index.
function findHeuristicStack(state, fromIdx, pipe, rules) {
  let bestNonEmpty = -1;
  let bestNonEmptyTopOrder = -Infinity;

  let bestEmpty = -1;

  for (let i = 0; i < state.stacks.length; i++) {
    if (i === fromIdx) continue;
    if (!canPlace(state.stacks[i], pipe, rules)) continue;

    const stack = state.stacks[i];

    if (stack.length === 0) {
      // Candidate empty stack — remember the lowest index only.
      if (bestEmpty === -1 || i < bestEmpty) bestEmpty = i;
      continue;
    }

    const topOrder = stack[stack.length - 1].pickupOrder;

    // Prefer larger topOrder. Ties → lowest index.
    if (topOrder > bestNonEmptyTopOrder ||
        (topOrder === bestNonEmptyTopOrder && (bestNonEmpty === -1 || i < bestNonEmpty))) {
      bestNonEmpty = i;
      bestNonEmptyTopOrder = topOrder;
    }
  }

  // Prefer non-empty if any is legal; else fall back to empty.
  if (bestNonEmpty !== -1) return bestNonEmpty;
  return bestEmpty;
}

console.log("✅ Heuristic solver loaded");


// ============================================================
// SECTION 8: OPTIMAL SOLVER (BFS)
// ============================================================
// Explores all legal moves level by level (BFS) until it finds
// a state where all pipes are retrieved. BFS guarantees the first
// solved state is optimal (fewest relocations).
//
// IMPORTANT: retrieval is NOT a relocation. Only actual moves
// (from != to) are counted.
//
// HARD LIMITS: max 200,000 states, max 3 seconds.
// If hit: return { status: "limit reached" } — never guess.

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

// Generate successors. First apply autoRetrieve. If retrieval changed
// the state, that's the ONLY successor (retrieval is mandatory).
// Otherwise, enumerate all legal moves.
function generateSuccessors(state, rules) {
  const afterRetrieve = autoRetrieve(state);

  // If retrieval happened, process the resulting state recursively.
  // We do NOT count retrieval as a move, but we DO need to reach the
  // post-retrieval state before enumerating moves.
  if (afterRetrieve.nextNeeded !== state.nextNeeded) {
    return generateSuccessors(afterRetrieve, rules);
  }

  // No retrieval — enumerate legal moves, each followed by autoRetrieve.
  const successors = [];
  for (let from = 0; from < state.stacks.length; from++) {
    if (state.stacks[from].length === 0) continue;
    const blocker = state.stacks[from][state.stacks[from].length - 1];

    for (let to = 0; to < state.stacks.length; to++) {
      if (to === from) continue;
      if (!canPlace(state.stacks[to], blocker, rules)) continue;

      const movedState = applyMove(state, from, to, rules);
      if (!movedState) continue;

      // IMPORTANT: auto-retrieve immediately after the move.
      const finalState = autoRetrieve(movedState);

      successors.push({
        nextState: finalState,
        move: { from, to, pipeId: blocker.id }
      });
    }
  }
  return successors;
}

// Canonical key: sort the stacks (not the pipes inside them!),
// then append nextNeeded. Two states with the same key are equivalent.
function canonicalKey(state) {
  const stackKeys = state.stacks.map(s =>
    s.map(p => p.pickupOrder).join(',')  // NO .sort() inside
  );
  stackKeys.sort();  // sort the STACKS only
  return stackKeys.join('|') + '#' + state.nextNeeded;
}

// Eligibility check for the optimal solver (per spec).
function isOptimalEligible(scenario) {
  const totalPipes = scenario.stacks.reduce((s, st) => s + st.length, 0);
  if (totalPipes > 8) return false;
  if (scenario.N > 4) return false;
  if (scenario.H > 3) return false;
  return true;
}

console.log("✅ Optimal solver loaded (fixed)");

// ============================================================
// SECTION 9: BENCHMARK (Main — 1000 scenarios)
// ============================================================
// Runs the main benchmark asynchronously in chunks to avoid
// freezing the UI. Uses setTimeout between chunks.
//
// Returns a Promise resolving to:
// {
//   total: number of scenarios attempted,
//   solved: number that returned "solved",
//   rejected: number that returned null or "infeasible",
//   naive: { avg, median, min, max, total },
//   heuristic: { avg, median, min, max, total },
//   reductionPct: (naive.avg - heuristic.avg) / naive.avg * 100,
//   heuristicWorse: [ { seed, naive, heuristic } ... ],
//   progress: { done, total }
// }

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
        const seed = i;  // deterministic seed per scenario
        const scenario = createDefaultScenario(seed);

        if (!scenario) {
          rejected++;
          continue;
        }

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
            seed: seed,
            naive: naive.relocations,
            heuristic: heur.relocations
          });
        }
      }

      // Report progress.
      onProgress(i, count);

      if (i < count) {
        // Yield to the browser, then continue.
        setTimeout(processChunk, 0);
      } else {
        // Done — compute stats.
        resolve({
          total: count,
          solved: naiveResults.length,
          rejected: rejected,
          naive: summarize(naiveResults),
          heuristic: summarize(heuristicResults),
          reductionPct: computeReduction(naiveResults, heuristicResults),
          heuristicWorse: heuristicWorse
        });
      }
    }

    processChunk();
  });
}

// Compute summary stats for an array of numbers.
function summarize(arr) {
  if (arr.length === 0) {
    return { avg: 0, median: 0, min: 0, max: 0, total: 0 };
  }

  const sorted = arr.slice().sort((a, b) => a - b);
  const total = arr.reduce((s, x) => s + x, 0);
  const avg = total / arr.length;
  const median = arr.length % 2 === 1
    ? sorted[Math.floor(arr.length / 2)]
    : (sorted[arr.length / 2 - 1] + sorted[arr.length / 2]) / 2;

  return {
    avg: avg,
    median: median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    total: total
  };
}

// Compute % reduction from naive to heuristic.
function computeReduction(naiveArr, heurArr) {
  if (naiveArr.length === 0) return 0;
  const naiveAvg = naiveArr.reduce((s, x) => s + x, 0) / naiveArr.length;
  const heurAvg = heurArr.reduce((s, x) => s + x, 0) / heurArr.length;
  if (naiveAvg === 0) return 0;
  return ((naiveAvg - heurAvg) / naiveAvg) * 100;
}

console.log("✅ Benchmark (main) loaded");


// ============================================================
// SECTION 10: BENCHMARK (Small — 200 scenarios + Optimal)
// ============================================================
// Small scenarios (N=4, H=3) are within the optimal solver's
// limits. We run all three solvers and measure the heuristic's
// gap to optimal.
//
// Gap is computed on PAIRED results (same scenario, both solved).
// Scenarios where optimal hit "limit reached" are excluded from
// the gap but counted separately.

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
    const heuristicWorseThanNaive = [];
    const pairedHeurOpt = [];  // [{ heur, opt }] — only when both solved
    let optimalLimitReached = 0;
    let optimalWorseThanHeuristic = 0;
    let rejected = 0;
    let i = 0;

    function processChunk() {
      const chunkEnd = Math.min(i + chunkSize, count);

      for (; i < chunkEnd; i++) {
        const seed = i;
        const scenario = createScenario(seed, SMALL_N, SMALL_H, false, {
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
          heuristicWorseThanNaive.push({
            seed: seed,
            naive: naive.relocations,
            heuristic: heur.relocations
          });
        }

        // Optimal.
        const opt = solveOptimal(scenario);
        if (opt.status === "solved") {
          optimalResults.push(opt.relocations);
          pairedHeurOpt.push({ heur: heur.relocations, opt: opt.relocations });
          if (opt.relocations > heur.relocations) {
            optimalWorseThanHeuristic++;
          }
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
        // Compute gap on paired results.
        let gapSum = 0;
        let gapCount = 0;
        for (const pair of pairedHeurOpt) {
          if (pair.opt === 0) continue;  // avoid division by zero
          gapSum += (pair.heur - pair.opt) / pair.opt;
          gapCount++;
        }
        const gapPct = gapCount > 0 ? (gapSum / gapCount) * 100 : 0;

        resolve({
          total: count,
          solved: naiveResults.length,
          rejected: rejected,
          naive: summarize(naiveResults),
          heuristic: summarize(heuristicResults),
          optimal: summarize(optimalResults),
          gapToOptimalPct: gapPct,
          limitReachedCount: optimalLimitReached,
          pairedCount: pairedHeurOpt.length,
          heuristicWorseThanNaive: heuristicWorseThanNaive,
          optimalWorseThanHeuristic: optimalWorseThanHeuristic
        });
      }
    }

    processChunk();
  });
}

console.log("✅ Benchmark (small) loaded");

// ============================================================
// SECTION 11: SELF-CHECK
// ============================================================
// Run from the console with: runSelfCheck()
// Verifies:
//   (1) No solver produces an illegal move (replay every move list).
//   (2) On every small scenario where Optimal returned "solved",
//       Optimal <= Heuristic and Optimal <= Naive (assert).
//   (3) REPORT (without asserting) how often Heuristic > Naive.
// Prints a clear PASS/FAIL summary.

function runSelfCheck(options) {
  const opts = options || {};
  const count = opts.count || 100;

  console.log("=== runSelfCheck() starting ===");
  console.log(`Testing ${count} small scenarios (N=4, H=3, shuffle=10)...\n`);

  let pass = true;
  const failures = [];

  // Counters for report.
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

    // (1) Verify every solver's move list is legal.
    const solvers = [
      { name: "naive", result: naive },
      { name: "heuristic", result: heur },
      { name: "optimal", result: opt }
    ];

    for (const { name, result } of solvers) {
      if (result.status !== "solved") continue;
      const replay = replayAndVerify(scenario, result.moves);
      if (!replay.ok) {
        pass = false;
        illegalMoveCount++;
        failures.push({
          seed: seed,
          solver: name,
          error: replay.error,
          move: replay.failingMove
        });
      }
    }

    // (2) Assert Optimal <= Heuristic and Optimal <= Naive.
    if (opt.status === "solved") {
      solvedCount++;

      if (heur.status === "solved" && opt.relocations > heur.relocations) {
        pass = false;
        optWorseThanHeur++;
        failures.push({
          seed: seed,
          error: `Optimal (${opt.relocations}) > Heuristic (${heur.relocations})`
        });
      }

      if (naive.status === "solved" && opt.relocations > naive.relocations) {
        pass = false;
        optWorseThanNaive++;
        failures.push({
          seed: seed,
          error: `Optimal (${opt.relocations}) > Naive (${naive.relocations})`
        });
      }
    }

    // (3) Report heuristic > naive (do NOT assert).
    if (heur.status === "solved" && naive.status === "solved" && heur.relocations > naive.relocations) {
      heurWorseThanNaive++;
    }
  }

  // Print summary.
  console.log("=== Self-Check Results ===");
  console.log(`Scenarios tested:       ${count}`);
  console.log(`Optimal solved:         ${solvedCount}`);
  console.log(`Illegal moves found:    ${illegalMoveCount}`);
  console.log(`Optimal > Heuristic:    ${optWorseThanHeur} (must be 0)`);
  console.log(`Optimal > Naive:        ${optWorseThanNaive} (must be 0)`);
  console.log(`Heuristic > Naive:      ${heurWorseThanNaive} (report only, not a failure)`);
  console.log("");

  if (pass) {
    console.log("✅ SELF-CHECK PASSED");
  } else {
    console.log("❌ SELF-CHECK FAILED");
    console.log("Failures:");
    failures.slice(0, 10).forEach(f => console.log("  ", f));
    if (failures.length > 10) {
      console.log(`  ... and ${failures.length - 10} more`);
    }
  }

  return { pass, failures, stats: { heurWorseThanNaive, optWorseThanHeur, optWorseThanNaive, illegalMoveCount } };
}

// Replay a move list through the model, verifying every move is legal.
// Returns { ok: true } or { ok: false, error, failingMove }.
function replayAndVerify(scenario, moves) {
  // IMPORTANT: start with initial autoRetrieve, matching what solvers do.
  let state = autoRetrieve(initialState(scenario));

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const nextState = applyMove(state, m.from, m.to, scenario.rules);
    if (!nextState) {
      return {
        ok: false,
        error: `Move #${i + 1} is illegal`,
        failingMove: m
      };
    }
    state = autoRetrieve(nextState);
  }

  if (!isSolved(state)) {
    return {
      ok: false,
      error: "Scenario not solved after replaying all moves",
      failingMove: null
    };
  }

  return { ok: true };
}

console.log("✅ Self-check loaded");

// ============================================================
// SECTION 12: SVG BAR CHART
// ============================================================
// Simple hand-written SVG bar chart.
// Renders average relocations for Naive / Heuristic / Optimal.
// No external libraries — pure SVG strings.

function renderBarChart(container, data, options) {
  const opts = options || {};
  const width = opts.width || 600;
  const height = opts.height || 300;
  const padding = { top: 40, right: 20, bottom: 60, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // data = [{ label, value, color }, ...]
  const maxValue = Math.max(1, ...data.map(d => d.value));
  const barCount = data.length;
  const barGap = 20;
  const barWidth = (chartW - barGap * (barCount - 1)) / barCount;

  // Y-axis ticks (0, 25%, 50%, 75%, 100% of max).
  const ticks = 4;
  let yAxis = "";
  for (let i = 0; i <= ticks; i++) {
    const y = padding.top + chartH - (chartH * i / ticks);
    const value = (maxValue * i / ticks).toFixed(1);
    yAxis += `<line x1="${padding.left}" y1="${y}" x2="${padding.left + chartW}" y2="${y}" stroke="#334155" stroke-width="1" />`;
    yAxis += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" fill="#94a3b8" font-size="11">${value}</text>`;
  }

  // Bars.
  let bars = "";
  data.forEach((d, i) => {
    const barH = (d.value / maxValue) * chartH;
    const x = padding.left + i * (barWidth + barGap);
    const y = padding.top + chartH - barH;
    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${d.color}" rx="4" />`;
    bars += `<text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" fill="#e2e8f0" font-size="13" font-weight="600">${d.value.toFixed(2)}</text>`;
    bars += `<text x="${x + barWidth / 2}" y="${padding.top + chartH + 20}" text-anchor="middle" fill="#cbd5e1" font-size="12">${d.label}</text>`;
  });

  // Title.
  const title = opts.title || "Average Relocations";
  const svg = `
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}">
      <text x="${width / 2}" y="24" text-anchor="middle" fill="#e2e8f0" font-size="14" font-weight="600">${title}</text>
      ${yAxis}
      ${bars}
    </svg>
  `;

  if (container) {
    container.innerHTML = svg;
  }
  return svg;
}

console.log("✅ SVG bar chart loaded");

// ============================================================
// SECTION 13: I18N & THEME
// ============================================================
// All strings in one place. Switch language without reload.
// Theme (dark/light) saved to localStorage.

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
    demoPlaceholder: "Coming soon: yard visualization, manual mode, and solver comparison.",
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
    demoPlaceholder: "قريباً: عرض الساحة، الوضع اليدوي، ومقارنة الحلول.",
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

  // Update <html> attributes.
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";

  // Update text content.
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (dict[key]) el.textContent = dict[key];
  });

  // Update aria-labels.
  document.querySelectorAll("[data-i18n-aria]").forEach(el => {
    const key = el.getAttribute("data-i18n-aria");
    if (dict[key]) el.setAttribute("aria-label", dict[key]);
  });

  // Update toggle button label.
  const toggle = document.getElementById("langToggle");
  if (toggle) toggle.textContent = lang === "en" ? "العربية" : "English";

  // Save preference.
  localStorage.setItem("lang", lang);
}

// ---------- Theme ----------

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const icon = document.getElementById("themeIcon");
  if (icon) icon.textContent = theme === "dark" ? "🌙" : "☀️";
  localStorage.setItem("theme", theme);
}

// ---------- Init ----------

function initI18nAndTheme() {
  // Load saved preferences (or defaults).
  const savedLang = localStorage.getItem("lang") || "en";
  const savedTheme = localStorage.getItem("theme") || "dark";

  applyLanguage(savedLang);
  applyTheme(savedTheme);

  // Wire up buttons.
  const langToggle = document.getElementById("langToggle");
  if (langToggle) {
    langToggle.addEventListener("click", () => {
      applyLanguage(currentLang === "en" ? "ar" : "en");
    });
  }

  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }
}

// Run on page load.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initI18nAndTheme);
} else {
  initI18nAndTheme();
}

console.log("✅ i18n & theme loaded");