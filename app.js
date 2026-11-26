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
// SECTION 4: SCENARIO GENERATION (Part 2 — place on stacks)
// ============================================================
// Strategy: build the yard in REVERSE.
// Start with empty stacks, then place pipes in DECREASING
// pickupOrder (last-needed first, first-needed last).
// This guarantees the scenario is solvable: when we play it
// forward, the next-needed pipe is always reachable by undoing
// the placements. Random stack choice keeps it interesting.

function createScenario(seed, N, H, diameterRule) {
  const rules = defaultRules({ H: H, diameterRule: diameterRule });

  // Total pipes = N stacks × (avg ~H/2 fill). We want a "full-ish"
  // yard so the problem is non-trivial, but not always completely full.
  // We use a second rng derived from the seed to decide fill amount.
  const rng = makeRng(seed);

  // Decide how many pipes total: between 60% and 100% of N*H.
  const minPipes = Math.ceil(N * H * 0.6);
  const maxPipes = N * H;
  const totalPipes = randomInt(rng, minPipes, maxPipes);

  // Generate pipes (Section 3).
  const pipes = generatePipes(seed, totalPipes);

  // Sort pipes by pickupOrder DESCENDING (last-needed first).
  // This is the "reverse build" order.
  const buildOrder = pipes.slice().sort((a, b) => b.pickupOrder - a.pickupOrder);

  // Start with empty stacks.
  const stacks = Array.from({ length: N }, () => []);

  // Place each pipe on a random legal stack.
  for (const pipe of buildOrder) {
    // Find all stacks that can legally accept this pipe.
    const legalIdx = [];
    for (let i = 0; i < N; i++) {
      if (canPlace(stacks[i], pipe, rules)) legalIdx.push(i);
    }

    if (legalIdx.length === 0) {
      // Should not happen with our fill amount, but guard anyway.
      // Return null — caller treats as "rejected scenario".
      return null;
    }

    // Pick a random legal stack.
    const chosen = legalIdx[randomInt(rng, 0, legalIdx.length - 1)];
    stacks[chosen].push(pipe);
  }

  // Return a clean scenario object.
  return {
    seed: seed,
    N: N,
    H: H,
    rules: rules,
    stacks: stacks,
    totalPipes: totalPipes
  };
}

console.log("✅ Scenario generator (part 2) loaded");
// ===== createScenario smoke test =====

// 1) Basic shape
const sc = createScenario(42, 6, 4, false);
console.log("scenario keys:", Object.keys(sc));
console.log("stacks count:", sc.stacks.length);          // 6
console.log("totalPipes:", sc.totalPipes);               // between 15 and 24
console.log("stack heights:", sc.stacks.map(s => s.length)); // each ≤ 4

// 2) All stacks respect H
const allHeightsOk = sc.stacks.every(s => s.length <= sc.H);
console.log("all heights ≤ H:", allHeightsOk);           // true

// 3) Every pipe appears exactly once
const totalInStacks = sc.stacks.reduce((sum, s) => sum + s.length, 0);
console.log("pipes in stacks == totalPipes:", totalInStacks === sc.totalPipes); // true

// 4) Reproducibility
const sc2 = createScenario(42, 6, 4, false);
console.log("reproducible:", JSON.stringify(sc) === JSON.stringify(sc2)); // true

// 5) Pretty print one stack to eyeball
console.log("stack 0:", sc.stacks[0].map(p => p.pickupOrder));
console.log("stack 1:", sc.stacks[1].map(p => p.pickupOrder));

// 6) Try with diameter rule ON
const scStrict = createScenario(42, 6, 4, true);
console.log("strict scenario created:", scStrict !== null);
const strictOk = scStrict.stacks.every(s => {
  for (let i = 1; i < s.length; i++) {
    if (s[i].diameter !== s[i-1].diameter) return false;
  }
  return true;
});
console.log("strict diameter respected:", strictOk);    // true


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

  // Check solved immediately (after initial auto-retrieve).
  const startRetrieved = autoRetrieve(start);
  if (isSolved(startRetrieved)) {
    return { status: "solved", moves: [], relocations: 0 };
  }

  // Queue entries: { state, moves } where moves = list of actual moves only.
  const queue = [{ state: start, moves: [] }];
  const visited = new Set();
  visited.add(canonicalKey(start));

  let explored = 0;

  while (queue.length > 0) {
    explored++;
    if (explored > maxStates) {
      return { status: "limit reached", moves: [], relocations: 0 };
    }
    if (Date.now() - startTime > timeCapMs) {
      return { status: "limit reached", moves: [], relocations: 0 };
    }

    const { state, moves } = queue.shift();

    // Generate successors. Retrieval is applied INSIDE generateSuccessors.
    const successors = generateSuccessors(state, rules);

    for (const { nextState, move } of successors) {
      // If retrieval-only transition: move is null → don't count it.
      const nextMoves = move ? moves.concat([move]) : moves;

      // Check solved AFTER the transition.
      if (isSolved(nextState)) {
        return {
          status: "solved",
          moves: nextMoves,
          relocations: nextMoves.length
        };
      }

      const key = canonicalKey(nextState);
      if (visited.has(key)) continue;
      visited.add(key);

      queue.push({ state: nextState, moves: nextMoves });
    }
  }

  return { status: "infeasible", moves: [], relocations: 0 };
}

// Generate successors. First apply autoRetrieve. If retrieval changed
// the state, that's the ONLY successor (retrieval is mandatory).
// Otherwise, enumerate all legal moves.
function generateSuccessors(state, rules) {
  const afterRetrieve = autoRetrieve(state);

  // Retrieval happened → mandatory transition, not a relocation.
  if (afterRetrieve.nextNeeded !== state.nextNeeded) {
    return [{ nextState: afterRetrieve, move: null }];
  }

  // No retrieval → enumerate all legal moves.
  const successors = [];
  for (let from = 0; from < state.stacks.length; from++) {
    if (state.stacks[from].length === 0) continue;
    const blocker = state.stacks[from][state.stacks[from].length - 1];

    for (let to = 0; to < state.stacks.length; to++) {
      if (to === from) continue;
      if (!canPlace(state.stacks[to], blocker, rules)) continue;

      const nextState = applyMove(state, from, to, rules);
      if (!nextState) continue;

      successors.push({
        nextState,
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