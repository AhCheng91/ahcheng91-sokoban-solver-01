# ahcheng91-sokoban-solver-01

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/AhCheng91/ahcheng91-sokoban-solver-01/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard)

An entry for make.fun's "Build the best Sokoban solver" bounty: for every drawn level it writes
`/output/<id>/solution.txt`, the player's moves that push every box onto a goal, in exactly the
level's push-optimal number of pushes.

## Run it

```sh
MAKEFUN_INPUT_DIR=<set>/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

`main.ts` reads `$MAKEFUN_INPUT_DIR/<id>/level.txt` for every id there, in sorted order, and writes
`$MAKEFUN_OUTPUT_DIR/<id>/solution.txt`, one LURD string: a lower letter walks, an upper one pushes.

## How it solves

The generator draws a hallway one square wide with rooms off it, each room through a single door.
A box pushed out of a door into the hallway can never be pushed back, so no optimal answer moves a
box out of its room, and the level's optimum is the sum of its rooms' optima. That is the whole
idea: find the rooms, solve each one exactly, and let the player walk between them.

- **Rooms.** A box's *live* squares, those it can still be brought to a goal from, come from a
  reverse walk that pulls a box back from each goal over two open squares. The player's row holds
  no live square (nothing there can reach a goal), so cutting it away leaves one part per room.
  Every part with boxes in it must pair its boxes with its goals one for one.
- **A room.** A breadth-first search over states — the boxes' squares plus the player's reachable
  region, named by its lowest square — expanded in order of pushes, so the first solved state is
  push-optimal. It is one small search per room instead of one over the product of four rooms.
- **Pruning.** A box on a square it cannot reach a goal from is dead, and so is a box on a square
  in a frozen 2 x 2 block of walls and boxes; neither prune can hide a solution.
- **The answer.** Each push is preceded by the shortest walk to the square behind its box, found by
  breadth-first search around walls and boxes. Rooms are solved in turn from where the last one left
  the player, and a room's boxes stand on their goals for the next room's walk.

No clock, no randomness, no fixed tables: two runs on the same set write the same bytes. The
practice set is solved in its key's push-optimal count (13, 16, 29, 47 and 60 pushes), and sets
drawn afresh from the kit's generator in the same way, in about half a second a set.
