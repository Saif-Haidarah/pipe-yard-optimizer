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