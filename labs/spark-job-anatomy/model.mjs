// The job the figure runs, as a small discrete-event model. Every number on the page comes from here.
// Pure: no DOM. The build imports it, and the page inlines the same source.
//
//   spark.read.parquet("events/")              // 8 files of 128 MB
//     .filter(col("type") === "click")         // narrow: pipelined into stage 0
//     .repartition(3, col("user_id"))          // wide: a shuffle, so a stage boundary
//     .write.parquet("clicks/")                // the action: one job

export const JOB = {
  files: [128, 128, 128, 128, 128, 128, 128, 128], // input file sizes, MB
  maxPartitionMB: 128, // spark.sql.files.maxPartitionBytes (default 128 MB)
  openCostMB: 4, // spark.sql.files.openCostInBytes (default 4 MB)
  rowsPerCard: 100_000, // one drawn card stands for this many rows
  cardsPerPartition: 10, // 128 MB of events, about 1 M rows
  keepEvery: [3, 10], // the filter keeps 3 cards in 10 (clicks are 30 % of events)
  shufflePartitions: 3, // repartition(3, ...)
  executors: [
    { id: "A", cores: 2 },
    { id: "B", cores: 2 },
  ],
  // figure seconds; real tasks of this size take a few seconds too, but launches and status
  // updates take milliseconds in a real cluster and are slowed down here so they can be followed
  mapSeconds: [3.0, 2.4, 3.6, 2.7, 2.6, 3.3, 2.2, 3.1],
  reduceSeconds: [3.4, 3.0, 3.8],
  launch: 0.5, // driver to executor: the serialized task
  status: 0.45, // executor to driver: "finished, here is where my output is"
  plan: 0.9, // action to first launch: the driver builds the DAG of stages
  submit: 0.5, // last map status to the first reduce launch
};

// Spark's FilePartition packing (Spark 3.x): split files into pieces of at most maxSplitBytes,
// then pack the pieces, largest first, into partitions of at most maxSplitBytes (each file costs openCost extra).
export function inputPartitions(job = JOB) {
  const cores = job.executors.reduce((a, e) => a + e.cores, 0); // default parallelism
  const total = job.files.reduce((a, b) => a + b, 0);
  const bytesPerCore = (total + job.files.length * job.openCostMB) / cores;
  const maxSplit = Math.min(job.maxPartitionMB, Math.max(job.openCostMB, bytesPerCore));
  const pieces = [];
  job.files.forEach((size, file) => {
    for (let at = 0; at < size; at += maxSplit) pieces.push({ file, at, size: Math.min(maxSplit, size - at) });
  });
  pieces.sort((a, b) => b.size - a.size);
  const parts = [];
  let cur = null;
  for (const piece of pieces) {
    if (!cur || cur.size + piece.size > maxSplit) parts.push((cur = { size: 0, pieces: [] }));
    cur.pieces.push(piece);
    cur.size += piece.size + job.openCostMB;
  }
  return { maxSplit, bytesPerCore, cores, total, parts };
}

// Which drawn cards survive the filter, and which reduce partition each survivor hashes to.
// Partition p, card c (0 = bottom). Three in ten survive, one per key bucket, at varied places.
export function cardsOf(p, job = JOB) {
  const n = job.cardsPerPartition;
  const keep = [(p * 3 + 1) % n, (p * 7 + 4) % n, (p * 5 + 8) % n];
  while (new Set(keep).size < 3) keep[2] = (keep[2] + 1) % n;
  const order = [[0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1], [1, 0, 2], [2, 1, 0], [0, 1, 2], [2, 0, 1]][p % 8];
  return Array.from({ length: n }, (_, c) => {
    const at = keep.indexOf(c);
    return at < 0 ? -1 : order[at];
  });
}

export const SLOTS = JOB.executors.flatMap((e, ei) => Array.from({ length: e.cores }, (_, c) => ({ exec: ei, core: c, id: `${e.id}${c}` })));
// Spark's TaskSchedulerImpl spreads work across executors: offers go round-robin over hosts
export const OFFER_ORDER = (() => {
  const out = [];
  const most = Math.max(...JOB.executors.map((e) => e.cores));
  for (let c = 0; c < most; c++) JOB.executors.forEach((e, ei) => c < e.cores && out.push(SLOTS.findIndex((s) => s.exec === ei && s.core === c)));
  return out;
})();

// Run the job: a discrete-event schedule of every launch, task and transfer, from the action at t = 0.
export function schedule(job = JOB) {
  const { parts } = inputPartitions(job);
  const nMap = parts.length;
  const nRed = job.shufflePartitions;
  const tasks = [];
  const free = OFFER_ORDER.map((slot) => ({ slot, at: job.plan })); // when the driver knows each slot is free
  const pending = Array.from({ length: nMap }, (_, i) => i);
  const statusAt = [];
  // stage 0: the driver offers the next pending task to each slot as soon as it hears the slot is free
  const take = () => {
    free.sort((a, b) => a.at - b.at || OFFER_ORDER.indexOf(a.slot) - OFFER_ORDER.indexOf(b.slot));
    return free.shift();
  };
  const mapFiles = [];
  while (pending.length) {
    const offer = take();
    const i = pending.shift();
    const launch = offer.at;
    const start = launch + job.launch;
    const end = start + job.mapSeconds[i % job.mapSeconds.length];
    const done = end + job.status;
    const exec = SLOTS[offer.slot].exec;
    tasks.push({ stage: 0, index: i, slot: offer.slot, exec, launch, start, end, done });
    mapFiles.push({ task: i, exec, at: end });
    statusAt.push(done);
    free.push({ slot: offer.slot, at: done });
  }
  // a file's place in its executor's rack is the order it was written there
  for (const ex of job.executors.keys()) mapFiles.filter((f) => f.exec === ex).sort((a, b) => a.at - b.at).forEach((f, pos) => (f.pos = pos));
  const stage0Done = Math.max(...statusAt);
  // stage 1 is submitted only when every map output is registered with the driver
  const submit1 = stage0Done + job.submit;
  free.length = 0;
  OFFER_ORDER.forEach((slot) => free.push({ slot, at: submit1 }));
  const fetches = [];
  const writes = [];
  for (let j = 0; j < nRed; j++) {
    const offer = take();
    const launch = offer.at;
    const start = launch + job.launch;
    const dur = job.reduceSeconds[j % job.reduceSeconds.length];
    const end = start + dur;
    const done = end + job.status;
    const exec = SLOTS[offer.slot].exec;
    tasks.push({ stage: 1, index: j, slot: offer.slot, exec, launch, start, end, done });
    free.push({ slot: offer.slot, at: done });
    // fetch segment j of every map output. Like Spark's ShuffleBlockFetcherIterator, the remote requests go out
    // first and the local blocks are read from disk while those are in flight.
    const order = [...mapFiles].sort((a, b) => (a.exec === exec ? 1 : 0) - (b.exec === exec ? 1 : 0) || a.at - b.at);
    order.forEach((file, k) => {
      const at = start + 0.08 * dur + (k / order.length) * 0.55 * dur;
      fetches.push({ reduce: j, task: file.task, from: file.exec, to: exec, local: file.exec === exec, at, took: file.exec === exec ? 0.25 : 0.7 });
    });
    for (let m = 0; m < order.length; m++) writes.push({ reduce: j, exec, card: m, at: start + 0.3 * dur + (m / order.length) * 0.66 * dur });
  }
  const finished = Math.max(...tasks.map((t) => t.done));
  return { parts, nMap, nRed, tasks, mapFiles, fetches, writes, stage0Done, submit1, finished };
}

// Rows and sizes, for the readout and the panel.
export function totals(job = JOB) {
  const { parts, maxSplit, total } = inputPartitions(job);
  const rowsIn = parts.length * job.cardsPerPartition * job.rowsPerCard;
  const kept = parts.reduce((a, _, p) => a + cardsOf(p, job).filter((k) => k >= 0).length, 0);
  return { totalMB: total, maxSplit, partitions: parts.length, rowsIn, rowsKept: kept * job.rowsPerCard, perOutput: (kept / job.shufflePartitions) * job.rowsPerCard, slots: SLOTS.length };
}
