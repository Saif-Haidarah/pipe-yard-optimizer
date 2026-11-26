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
