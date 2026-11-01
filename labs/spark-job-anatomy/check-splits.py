# How many tasks does a large file get when it can be split, and when it cannot (gzip, binaryFile)?
# python3 check-splits.py       Spark 4.0.1, local-cluster 2 x 2. See README.md, "Experiments for the cases".
import gzip, json, os, random, shutil, time, urllib.request

from pyspark.sql import SparkSession

ROOT = "/tmp/spark/work-splits"
shutil.rmtree(ROOT, ignore_errors=True)
spark = (
    SparkSession.builder.master("local-cluster[2,2,1024]")
    .config("spark.ui.showConsoleProgress", "false")
    .config("spark.ui.port", "4041")
    .config("spark.sql.files.maxPartitionBytes", str(8 << 20))
    .getOrCreate()
)
sc = spark.sparkContext
sc.setLogLevel("ERROR")
app = sc.applicationId


def api(path):
    with urllib.request.urlopen(f"http://localhost:4041/api/v1/applications/{app}/{path}") as r:
        return json.loads(r.read())


# three 8 MB files and one 64 MB file of text lines, once plain and once gzipped
random.seed(1)
words = ["alpha", "beta", "gamma", "delta", "omega", "sigma", "kappa", "theta"]
sizes = {"small1": 8, "small2": 8, "small3": 8, "large": 64}
for kind in ["plain", "gzip"]:
    os.makedirs(f"{ROOT}/{kind}")
for name, mb in sizes.items():
    lines = []
    total = 0
    while total < mb << 20:
        line = " ".join(random.choice(words) + str(random.randrange(10**6)) for _ in range(8)) + "\n"
        lines.append(line)
        total += len(line)
    data = "".join(lines).encode()
    open(f"{ROOT}/plain/{name}.txt", "wb").write(data)
    with gzip.open(f"{ROOT}/gzip/{name}.txt.gz", "wb") as f:
        f.write(data)
for kind in ["plain", "gzip"]:
    print(kind, {f: round(os.path.getsize(f"{ROOT}/{kind}/{f}") / 2**20, 1) for f in sorted(os.listdir(f"{ROOT}/{kind}"))}, "MiB on disk")


def run(label, df):
    sc.setJobGroup(label, label)
    t0 = time.time()
    rows = df.count()
    time.sleep(1)
    jobs = [j for j in api("jobs") if j.get("jobGroup") == label]
    stage = min(s for j in jobs for s in j["stageIds"])  # the scan stage
    tasks = api(f"stages/{stage}/0/taskList?length=500")
    per = sorted(((t["taskMetrics"]["inputMetrics"]["bytesRead"] >> 20, round(t["duration"] / 1000, 2)) for t in tasks), reverse=True)
    print(f"{label:<28} rows {rows:>9,}  partitions {df.rdd.getNumPartitions():>3}  scan tasks {len(tasks):>3}  "
          f"longest task {max(d for _, d in per):5.2f} s  (MiB read, s) per task: {per[:6]}{' ...' if len(per) > 6 else ''}  {time.time() - t0:4.1f} s")


run("text, plain (splittable)", spark.read.text(f"{ROOT}/plain"))
run("text, gzip (not splittable)", spark.read.text(f"{ROOT}/gzip"))
run("binaryFile, gzip (whole files)", spark.read.format("binaryFile").load(f"{ROOT}/gzip"))
spark.stop()
