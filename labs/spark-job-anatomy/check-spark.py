# Checks the figure against a real Spark 4.0.1 run: 2 executors x 2 cores on one machine (local-cluster).
# python3 check-spark.py true|false   (AQE on or off). See README.md, "Measured on Spark 4.0.1".
import json, os, shutil, sys, time, urllib.request, glob

from pyspark.sql import SparkSession, functions as F

ROOT = "/tmp/spark/work"
shutil.rmtree(ROOT, ignore_errors=True)
os.makedirs(ROOT)
AQE = sys.argv[1] if len(sys.argv) > 1 else "true"

spark = (
    SparkSession.builder.master("local-cluster[2,2,1024]")
    .config("spark.sql.adaptive.enabled", AQE)
    .config("spark.ui.port", "4040")
    .config("spark.ui.showConsoleProgress", "false")
    .getOrCreate()
)
sc = spark.sparkContext
sc.setLogLevel("ERROR")
app = sc.applicationId
print("spark", spark.version, "AQE", spark.conf.get("spark.sql.adaptive.enabled"), "defaultParallelism", sc.defaultParallelism)


def api(path):
    with urllib.request.urlopen(f"http://localhost:4040/api/v1/applications/{app}/{path}") as r:
        return json.loads(r.read())


def jobs_of(group):
    time.sleep(0.6)
    out = []
    for j in api("jobs"):
        if j.get("jobGroup") == group:
            out.append({"job": j["jobId"], "stages": j["stageIds"], "skippedStages": j["numSkippedStages"], "tasks": j["numCompletedTasks"], "skippedTasks": j["numSkippedTasks"]})
    return sorted(out, key=lambda x: x["job"])


def jobs_of_tracker(group):
    out = []
    for jid in sorted(sc.statusTracker().getJobIdsForGroup(group)):
        info = sc.statusTracker().getJobInfo(jid)
        stages = []
        for sid in info.stageIds:
            s = sc.statusTracker().getStageInfo(sid)
            stages.append((sid, s.numTasks if s else "skipped"))
        out.append((jid, info.status, stages))
    return out


# ---- experiment A: input partition packing on files of exact sizes
def text_files(name, sizes):
    d = f"{ROOT}/{name}"
    os.makedirs(d)
    for i, n in enumerate(sizes):
        line = b"x" * 99 + b"\n"
        with open(f"{d}/f{i}.txt", "wb") as f:
            f.write(line * (n // 100) + b"y" * (n % 100))
    return d

KB = 1024
spark.conf.set("spark.sql.files.maxPartitionBytes", str(1024 * KB))
spark.conf.set("spark.sql.files.openCostInBytes", str(32 * KB))
for name, sizes in [("eight1m", [1024 * KB] * 8), ("eight300k", [300 * KB] * 8), ("mixed", [2500 * KB, 700 * KB, 200 * KB, 200 * KB, 90 * KB])]:
    d = text_files(name, sizes)
    print("A", name, "partitions", spark.read.text(d).rdd.getNumPartitions())
spark.conf.unset("spark.sql.files.maxPartitionBytes")
spark.conf.unset("spark.sql.files.openCostInBytes")

# ---- experiment B: the figure's query, on 8 parquet files
src = f"{ROOT}/events"
(spark.range(0, 800_000, numPartitions=8)
 .select((F.col("id") % 50_000).alias("user_id"), F.when(F.col("id") % 10 < 3, "click").otherwise("view").alias("type"), F.rand(1).alias("v"))
 .write.parquet(src))
print("B files", len(glob.glob(f"{src}/*.parquet")))
# make the 8 files 8 partitions, whatever their exact size: one split per file
spark.conf.set("spark.sql.files.openCostInBytes", str(1 << 30))

sc.setJobGroup("read", "read")
df = spark.read.parquet(src)
print("B read jobs", jobs_of("read"))

sc.setJobGroup("plan", "plan")
q = df.filter(F.col("type") == "click").repartition(3, "user_id")
print("B transformations jobs", jobs_of("plan"))

sc.setJobGroup("write", "write")
out = f"{ROOT}/clicks"
t0 = time.time()
q.write.mode("overwrite").parquet(out)
print("B write jobs", jobs_of("write"))
print("B output files", sorted(os.path.basename(p) for p in glob.glob(f"{out}/*") ))

# stage details from the REST API: tasks per executor, timing, shuffle read local vs remote
time.sleep(1.5)
stages = [s for s in api("stages?status=complete") ]
for s in sorted(stages, key=lambda s: s["stageId"]):
    tasks = api(f"stages/{s['stageId']}/{s['attemptId']}/taskList?length=200")
    launch = [t["launchTime"] for t in tasks]
    ends = [t["launchTime"] for t in tasks]
    ex = {}
    for t in tasks:
        ex[t["executorId"]] = ex.get(t["executorId"], 0) + 1
    sr = [t.get("taskMetrics", {}).get("shuffleReadMetrics", {}) for t in tasks]
    print("stage", s["stageId"], s["name"][:40], "tasks", s["numTasks"], "byExecutor", ex,
          "firstLaunch", min(launch), "submission", s.get("submissionTime"), "completion", s.get("completionTime"),
          "shuffleWrite", s.get("shuffleWriteBytes"), "shuffleRead", s.get("shuffleReadBytes"),
          "localBlocks", sum(m.get("localBlocksFetched", 0) for m in sr), "remoteBlocks", sum(m.get("remoteBlocksFetched", 0) for m in sr),
          "remoteBytesToDisk/hostlocal?", sum(m.get("remoteBytesRead", 0) for m in sr))

# map output layout on disk: one .data + one .index per map task
data, idx = [], []
for top in ["/tmp", os.environ.get("SPARK_HOME")]:
    for d, _, files in os.walk(top):
        for f in files:
            if f.startswith("shuffle_") and f.endswith(".data"): data.append(os.path.join(d, f))
            if f.startswith("shuffle_") and f.endswith(".index"): idx.append(os.path.join(d, f))
print("shuffle data files", len(data), "index files", len(idx), sorted(os.path.basename(p) for p in data)[:10])

# a second action on the same DataFrame: is the shuffle reused (stage skipped)?
sc.setJobGroup("again", "again")
q.write.mode("overwrite").parquet(out + "2")
print("C second write on same DataFrame", jobs_of("again"))
sc.setJobGroup("count", "count")
print("C count", q.count(), jobs_of("count"))
sc.setJobGroup("collect1", "collect1")
n1 = len(q.collect())
print("D first collect", n1, jobs_of("collect1"))
sc.setJobGroup("collect2", "collect2")
n2 = len(q.collect())
print("D second collect on same DataFrame", n2, jobs_of("collect2"))
spark.stop()
