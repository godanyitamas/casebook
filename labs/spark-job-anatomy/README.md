---
type: lab
status: draft
created: 2026-11-01
topics:
  - spark-performance
  - partitioning
---

# Anatomy of a Spark job (interactive figure)

An explainer of what happens when one Spark action runs: the driver, the job, its stages and tasks, input and shuffle partitions, executors, cores, workers and the shuffle. An AI agent built it on request with the anatomy figure skill. It is not drawn from one of my cases. One small model (`model.mjs`) drives every number and motion in the figure.

![The bench in stage 1: the driver console with its lamp board and lever at the back, two workers with an executor and two core slots each, shuffle files on their local disks, input decks on the left shelf and output trays filling on the right](spark-job.png)

Open `spark-job.html` (light) or `spark-job-dark.html` in a browser.

## The job it runs

```
spark.read.parquet("events/")          // 1 GB in 8 files of 128 MB
  .filter(col("type") === "click")     // narrow
  .repartition(3, col("user_id"))      // wide: a shuffle
  .write.parquet("clicks/")            // the action
```

## What is on the figure

| Spark | Part of the bench | What it does in the figure |
|---|---|---|
| Action → job | the lever on the driver console | Pulling it (Space) starts one job; it springs back when the last task reports |
| Driver | the console | Holds the lamp board; sends tasks and receives status updates over the network |
| Stages | the two lamp rows and the bus between them | 8 lamps for stage 0, 3 for stage 1; the bus lights when every stage 0 task has reported |
| Task | a lamp, a ticket standing in a core slot, the slot's dial | Ticket arrives over the cable; the dial sweeps once while the task runs |
| Input partition | a deck of 10 cards in the left shelf (1 card = 100 k rows) | Cards light top to bottom as the task streams them; the input stays in storage |
| Key buckets | card colours (grey = rows the filter drops) | Every input deck mixes all three; every output tray holds one |
| Worker | a chassis on the bench | Carries an executor and a local disk |
| Executor | the carrier plate with a heap strip | A JVM started for this application; two core slots each |
| Core (task slot) | a slot housing with roller, ticket clip, dial and busy lamp | One task at a time |
| Shuffle files | 3-card files in the local-disk rack | One file per map task, sorted by target partition; segments dim once fetched but stay on disk |
| Network | the switch and six cables | Packets: tickets (white/black), status (grey), input rows (grey or coloured), shuffle fetches and output writes (coloured) |
| Cluster manager | the small box in front of the switch | Started the executors; during the job it only tracks heartbeats |
| Output partitions | the three trays on the right shelf | One `part-` file per stage 1 task |

Controls: **Run the job** (Space), **Pause** (P), a speed slider. The eleven part buttons (or ←/→, 1–9, 0) light one part and explain it in the panel. Hovering a part on the bench previews it, and clicking selects it. Left alone, the figure runs the job, holds the result for about four seconds and runs it again.

## Model (`model.mjs`)

- **Input partitions.** The model follows Spark 3.x `FilePartition` packing. With `maxPartitionBytes` 128 MB, `openCostInBytes` 4 MB and a default parallelism of 4 cores, it gets `bytesPerCore` = (1024 + 8·4) / 4 = 264 MB. The split size is min(128, 264) = 128 MB, which gives 8 partitions. The count comes out of the computation; it is not set by hand.
- **Shuffle partitions.** There are 3, because `repartition(3, …)` names the count. Without it, `spark.sql.shuffle.partitions` (200) would apply, or whatever AQE coalesces it to.
- **Scheduling** is a discrete-event simulation:
  - The driver offers slots round-robin across executors.
  - A slot gets its next task only when the driver receives the previous task's status.
  - Stage 1 is submitted only after every stage 0 status has arrived.
  - With 8 tasks on 4 slots, stage 0 runs in two ragged waves. With 3 tasks, one slot idles in stage 1.
- **Shuffle read.** Each reduce task fetches its segment from all 8 map outputs. Remote requests go out first and local blocks are read while those are in flight, as in `ShuffleBlockFetcherIterator`. Here each executor ran 4 map tasks, so every reduce task reads 4 segments locally and 4 remotely.
- **Data.** The filter keeps 3 cards in 10 (30 %), one per key bucket: 8.0 M rows in, 2.4 M shuffled, 0.8 M per output file.
- **Time.**
  - Map tasks take 2.2–3.6 s and reduce tasks 3.0–3.8 s. That is plausible for 128 MB, but it is not measured.
  - Launches (0.5 s), status updates (0.45 s) and network transfers are slowed down; in a real cluster they take milliseconds.
  - The whole job takes 14.8 s of figure time.

## Simplifications and what the figure does not show

- **AQE splits the work into more jobs.** With adaptive query execution (on by default since Spark 3.2), Spark SQL submits each shuffle stage as its own job. The Spark UI can then show this query as more than one job, with the earlier stage listed as skipped in the later job. The figure shows the classic model: one action, one job, two stages.
- **Shuffle file layout is idealised.** Exactly one card per key bucket per map task means no skew and no partial aggregation. Real shuffle files differ in size per segment, and one hot key makes one reduce task much longer.
- **Not drawn:**
  - data locality (object storage has none; HDFS does);
  - speculative execution, task retries and fetch failures (which resubmit the map stage);
  - dynamic allocation;
  - memory and spill;
  - the external shuffle service;
  - the driver collecting results (`write` sends back only commit messages).
- **Shuffle files outlive the job.** Here they stay until the next run clears the bench. Spark keeps them until the shuffle is garbage-collected, which is why a later job can skip a stage. I have not checked when Spark SQL reuses a shuffle between two actions on the same DataFrame.
- **Cluster manager role is simplified.** The heartbeat blink is decorative timing, not a Spark interval. Executors heartbeat to the driver (`spark.executor.heartbeatInterval`, 10 s by default), and workers heartbeat to the cluster manager.

## Checks

- `node build.mjs --audit` ends `audit passed`: 6 cables, 326 solids, 361 items, 0 problems in every check.
- `scripts/lines.mjs` reports 0 floating line ends on both pages: at rest, in stage 1 and after the job.
- Captures were checked in both themes, at 390 px, with a focused part, with reduced motion (which shows the finished job), and at 4× over the worker, the driver console and the shuffle rack.
- **Not proved:** the audit sees only the rest pose. The lever is recorded only at rest; it is rebuilt each frame in the page.

## Rebuild

`node build.mjs` writes `spark-job.html`, and `node build.mjs --dark` writes `spark-job-dark.html`; add `--audit` to run the geometry audit. The build needs the figure kit from the anatomy skill, found at `~/.claude/skills/anatomy` or `$ANATOMY_DIR`. Viewing the HTML needs nothing.

Files: `model.mjs` (the job and its schedule), `build.mjs` (geometry and page), `live.js` (the page's loop, packets and controls).
