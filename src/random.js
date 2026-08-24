export function createRandom(seed = 20260811) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(random) {
  let first = 0;
  let second = 0;
  while (first === 0) first = random();
  while (second === 0) second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

export function gammaSample(shape, random) {
  if (!(shape > 0)) throw new RangeError("Gamma shape must be positive");
  if (shape < 1) {
    return gammaSample(shape + 1, random) * Math.pow(random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = normalSample(random);
      v = 1 + c * x;
    } while (v <= 0);
    v *= v * v;
    const uniform = random();
    if (uniform < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(uniform) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function betaSample(alpha, beta, random) {
  const left = gammaSample(alpha, random);
  const right = gammaSample(beta, random);
  return left / (left + right);
}

export function dirichletSample(parameters, random) {
  const values = parameters.map((parameter) => gammaSample(parameter, random));
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
}

