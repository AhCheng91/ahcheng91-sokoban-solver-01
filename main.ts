// A Sokoban solver for make.fun's sokoban-solver-01: the level's rooms are found, each is solved
// push-optimally on its own, and the answers are joined by the player's walks between them.
//
// The generator draws a hallway one square wide with rooms off it, each room opening onto the
// hallway through one door. A box pushed through a door into the hallway can never be pushed
// back, so no optimal answer ever moves a box out of its room, and the level's push-optimal
// count is the sum of its rooms' optima. Solving a room at a time turns one search over the
// product of the rooms' positions into a few small ones.
//
// Run: MAKEFUN_INPUT_DIR=<dir with i001..i005> MAKEFUN_OUTPUT_DIR=<dir> node main.ts

const { mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** up, down, left, right: the step's letter, its square offset and its column step, on a board of width w. */
const LETTERS = ['u', 'd', 'l', 'r'];
const COL_STEP = [0, 0, -1, 1];
const ROW_STEP = [-1, 1, 0, 0];

/** The most states one room's search keeps before it gives up on that room (work, never the clock). */
const STATE_CAP = 1500000;

/** The level: its size, walls, goals, boxes and player, from its XSB text (# wall, . goal, $ box, * box on a goal, @ player, + player on a goal). */
function parseLevel(text) {
  const rows = text.split('\n').filter((row) => row.length > 0);
  const h = rows.length;
  let w = 0;
  for (const row of rows) if (row.length > w) w = row.length;
  const n = w * h;
  const wall = new Uint8Array(n).fill(1);
  const goal = new Uint8Array(n);
  const boxes = [];
  let player = -1;
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '#') continue;
      const i = y * w + x;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goal[i] = 1;
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  }
  // Nothing leaves the board: the outermost ring is wall, wherever a short row left it open.
  for (let x = 0; x < w; x++) {
    wall[x] = 1;
    wall[(h - 1) * w + x] = 1;
  }
  for (let y = 0; y < h; y++) {
    wall[y * w] = 1;
    wall[y * w + w - 1] = 1;
  }
  boxes.sort((a, b) => a - b);
  return { w, h, n, wall, goal, boxes, player, row: Math.floor(player / w) };
}

/**
 * The squares a box can still be brought to a goal from, ignoring the other boxes: a reverse
 * breadth-first walk from the goals, each step pulling a box back over two open squares. A box on
 * a square left out here is already lost, so the search never tries it.
 */
function liveSquares(w, wall, goals) {
  const n = wall.length;
  const live = new Uint8Array(n);
  const queue = [];
  for (const g of goals) {
    if (wall[g]) continue;
    live[g] = 1;
    queue.push(g);
  }
  for (let k = 0; k < queue.length; k++) {
    const to = queue[k];
    for (let i = 0; i < 4; i++) {
      const d = ROW_STEP[i] * w + COL_STEP[i];
      const from = to - d;
      const behind = from - d;
      if (from < 0 || from >= n || behind < 0 || behind >= n) continue;
      if (wall[from] || wall[behind] || live[from]) continue;
      live[from] = 1;
      queue.push(from);
    }
  }
  return live;
}

/**
 * The level's rooms: the parts left of the floor once the hallway (the player's row, where no box
 * can reach a goal) is cut away. Each part with boxes in it is a room; null when the parts do not
 * pair boxes with goals one for one, so the level is not a set of rooms.
 */
function roomsOf(level) {
  const { w, n, wall, goal, boxes, row } = level;
  const live = liveSquares(w, wall, goal);
  const cut = new Uint8Array(n);
  for (let x = 1; x < w - 1; x++) {
    const i = row * w + x;
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  const part = new Int32Array(n).fill(-1);
  const parts = [];
  for (let s = 0; s < n; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const id = parts.length;
    const cells = [s];
    part[s] = id;
    for (let k = 0; k < cells.length; k++) {
      const p = cells[k];
      for (let i = 0; i < 4; i++) {
        const q = p + ROW_STEP[i] * w + COL_STEP[i];
        if (wall[q] || cut[q] || part[q] >= 0) continue;
        part[q] = id;
        cells.push(q);
      }
    }
    const mark = new Uint8Array(n);
    for (const c of cells) mark[c] = 1;
    parts.push({ cells, mark, boxes: [], goals: [] });
  }
  for (const b of boxes) {
    if (part[b] < 0) return null;
    parts[part[b]].boxes.push(b);
  }
  let unmatched = false;
  for (let i = 0; i < n; i++) {
    if (!goal[i]) continue;
    if (part[i] < 0) unmatched = true;
    else parts[part[i]].goals.push(i);
  }
  if (unmatched) return null;
  const rooms = parts.filter((r) => r.boxes.length > 0);
  for (const r of rooms) if (r.boxes.length !== r.goals.length) return null;
  return { rooms, cut };
}

/** The squares the player reaches from `from` around `wall` and `blocked`, marked with `stamp` in `mark`: the lowest one. */
function markRegion(w, wall, blocked, from, mark, stamp, stack) {
  let low = from;
  let top = 0;
  stack[top++] = from;
  mark[from] = stamp;
  while (top > 0) {
    const p = stack[--top];
    if (p < low) low = p;
    for (let i = 0; i < 4; i++) {
      const q = p + ROW_STEP[i] * w + COL_STEP[i];
      if (wall[q] || blocked[q] || mark[q] === stamp) continue;
      mark[q] = stamp;
      stack[top++] = q;
    }
  }
  return low;
}

/**
 * Whether the box just pushed onto `to` belongs to a 2 x 2 block of walls and boxes: such a block
 * never comes apart, so a box in it that is off a goal is lost.
 */
function stuckBlock(w, wall, blocked, goal, to) {
  for (let k = 0; k < 4; k++) {
    const a = to + (k === 0 ? 0 : k === 1 ? -1 : k === 2 ? -w : -w - 1);
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || blocked[a])) continue;
    if (!(wall[b] || blocked[b])) continue;
    if (!(wall[c] || blocked[c])) continue;
    if (!(wall[d] || blocked[d])) continue;
    if ((blocked[a] && !goal[a]) || (blocked[b] && !goal[b]) || (blocked[c] && !goal[c]) || (blocked[d] && !goal[d])) return true;
  }
  return false;
}

/** The shortest walk from `from` to `to` around walls and `blocked`, as lower LURD letters (up, down, left, right on ties). */
function walk(w, wall, blocked, from, to) {
  if (from === to) return '';
  const n = wall.length;
  const prev = new Int32Array(n).fill(-1);
  const how = new Array(n);
  const queue = [from];
  prev[from] = from;
  for (let k = 0; k < queue.length; k++) {
    const p = queue[k];
    if (p === to) break;
    for (let i = 0; i < 4; i++) {
      const q = p + ROW_STEP[i] * w + COL_STEP[i];
      if (wall[q] || blocked[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = LETTERS[i];
      queue.push(q);
    }
  }
  if (prev[to] === -1) return null;
  let path = '';
  for (let p = to; p !== from; p = prev[p]) path = how[p] + path;
  return path;
}

/** The square the player stands on after `moves` (LURD) from `from` on a board `w` wide. */
function endOf(w, from, moves) {
  let p = from;
  for (let i = 0; i < moves.length; i++) {
    const ch = moves[i].toLowerCase();
    p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  }
  return p;
}

/**
 * One room's push-optimal answer: a breadth-first search over states (the boxes' squares and the
 * player's reachable region, named by its lowest square), expanded in order of pushes, so the
 * first solved state met is optimal. Two deadlocks are pruned: a box on a square it can never
 * reach a goal from, and a box in a frozen 2 x 2 block. Neither loses a solvable state.
 *
 * Answers {pushes, moves} (LURD, an upper letter for a push), or null when the room needs more
 * than `cap` states or has no solution.
 */
function solveRoom(w, wall, goal, boxes0, player, live, cap) {
  const n = wall.length;
  const blocked = new Uint8Array(n);
  let solved0 = true;
  for (const b of boxes0) {
    blocked[b] = 1;
    if (!goal[b]) solved0 = false;
  }
  if (solved0) return { pushes: 0, moves: '' };

  // Two sets of marks: one for the state being expanded, one for the region a push leaves the
  // player in (its lowest square goes into the next state's key).
  const hereMark = new Int32Array(n);
  const awayMark = new Int32Array(n);
  const stack = new Int32Array(n);
  let stamp = 0;
  const low0 = markRegion(w, wall, blocked, player, hereMark, ++stamp, stack);
  for (const b of boxes0) blocked[b] = 0;

  const keyOf = (bs, low) => {
    let key = low;
    for (let i = 0; i < bs.length; i++) key = key * n + bs[i];
    return key;
  };

  const keys = new Set();
  const stateBoxes = [Int32Array.from(boxes0)];
  const statePlayer = [player];
  const stateParent = [-1];
  const stateFrom = [-1];
  const stateDir = [-1];
  keys.add(keyOf(boxes0, low0));

  let found = -1;
  for (let head = 0; head < stateBoxes.length && found < 0; head++) {
    const bs = stateBoxes[head];
    for (let i = 0; i < bs.length; i++) blocked[bs[i]] = 1;
    markRegion(w, wall, blocked, statePlayer[head], hereMark, ++stamp, stack);
    const here = stamp;
    for (let bi = 0; bi < bs.length && found < 0; bi++) {
      const b = bs[bi];
      for (let di = 0; di < 4; di++) {
        const d = ROW_STEP[di] * w + COL_STEP[di];
        const to = b + d;
        if (hereMark[b - d] !== here || wall[to] || blocked[to] || !live[to]) continue;
        blocked[b] = 0;
        blocked[to] = 1;
        const stuck = stuckBlock(w, wall, blocked, goal, to);
        let key = -1;
        let next = null;
        if (!stuck) {
          next = Int32Array.from(bs);
          next[bi] = to;
          next.sort();
          key = keyOf(next, markRegion(w, wall, blocked, b, awayMark, ++stamp, stack));
        }
        blocked[to] = 0;
        blocked[b] = 1;
        if (stuck || keys.has(key)) continue;
        if (stateBoxes.length >= cap) {
          for (let i = 0; i < bs.length; i++) blocked[bs[i]] = 0;
          return null;
        }
        keys.add(key);
        stateBoxes.push(next);
        statePlayer.push(b);
        stateParent.push(head);
        stateFrom.push(b);
        stateDir.push(di);
        let done = true;
        for (let i = 0; i < next.length; i++) if (!goal[next[i]]) { done = false; break; }
        if (done) {
          found = stateBoxes.length - 1;
          break;
        }
      }
    }
    for (let i = 0; i < bs.length; i++) blocked[bs[i]] = 0;
  }
  if (found < 0) return null;

  const steps = [];
  for (let s = found; s > 0; s = stateParent[s]) steps.push(s);
  steps.reverse();
  let moves = '';
  const boxes = Array.from(boxes0);
  let at = player;
  for (const s of steps) {
    const from = stateFrom[s];
    const di = stateDir[s];
    const d = ROW_STEP[di] * w + COL_STEP[di];
    for (const b of boxes) blocked[b] = 1;
    moves += walk(w, wall, blocked, at, from - d);
    for (const b of boxes) blocked[b] = 0;
    moves += LETTERS[di].toUpperCase();
    boxes[boxes.indexOf(from)] = from + d;
    at = from;
  }
  return { pushes: steps.length, moves };
}

/** The whole level answered: each room solved in turn, the player walking on from where the last one left it. */
function solve(level) {
  const { w, n, wall, goal, boxes, player } = level;
  const found = roomsOf(level);
  if (found === null) return '';
  const { rooms, cut } = found;
  const boxAt = new Uint8Array(n);
  for (const b of boxes) boxAt[b] = 1;
  let at = player;
  let moves = '';
  for (const room of rooms) {
    // The room's square beside the hallway, and the hallway square outside it.
    let door = -1;
    for (const c of room.cells) {
      for (let i = 0; i < 4; i++) {
        const q = c + ROW_STEP[i] * w + COL_STEP[i];
        if (cut[q]) { door = q; break; }
      }
      if (door >= 0) break;
    }
    if (door < 0) return '';
    const toDoor = walk(w, wall, boxAt, at, door);
    if (toDoor === null) return '';
    moves += toDoor;
    at = door;

    // The room's own board: its squares and the hallway, every other room a wall, and no box ever
    // reaching a goal through the hallway.
    const sub = wall.slice();
    for (let i = 0; i < n; i++) if (!wall[i] && !cut[i] && !room.mark[i]) sub[i] = 1;
    const live = liveSquares(w, sub, room.goals);
    for (let i = 0; i < n; i++) if (cut[i]) live[i] = 0;
    const answer = solveRoom(w, sub, goal, room.boxes, at, live, STATE_CAP);
    if (answer === null) return '';
    moves += answer.moves;
    at = endOf(w, at, answer.moves);
    for (const b of room.boxes) boxAt[b] = 0;
    for (const g of room.goals) boxAt[g] = 1;
  }
  return moves;
}

for (const id of readdirSync(INPUT_DIR).sort()) {
  const level = parseLevel(readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8'));
  const moves = solve(level);
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
