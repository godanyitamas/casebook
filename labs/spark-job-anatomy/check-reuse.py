# Does a second write recompute an expensive step, and does caching stop it? (batch and foreachBatch)
# python3 check-reuse.py        Spark 4.0.1, local-cluster 2 x 2. See README.md, "Experiments for the cases".
import os, shutil, time

from pyspark.sql import SparkSession, functions as F
from pyspark.sql.types import IntegerType

ROOT = "/tmp/spark/work-reuse"
shutil.rmtree(ROOT, ignore_errors=True)
os.makedirs(ROOT)
spark = (
    SparkSession.builder.master("local-cluster[2,2,1024]")
    .config("spark.ui.showConsoleProgress", "false")
    .getOrCreate()
)
sc = spark.sparkContext
sc.setLogLevel("ERROR")

ROWS = 200_000
src = f"{ROOT}/input"
spark.range(0, ROWS, numPartitions=8).select(F.col("id"), (F.col("id") * 7919 % 1000).cast("string").alias("payload")).write.parquet(src)

calls = sc.accumulator(0)


def parse(payload):  # stands in for an expensive parser: every call is counted
    calls.add(1)
    return len(payload) * 3 + int(payload) % 11


parse_udf = F.udf(parse, IntegerType())


def two_writes(df, tag, cache):
    parsed = df.withColumn("p", parse_udf("payload"))
    if cache:
        parsed = parsed.persist()
    parsed.select("id", "p").write.mode("overwrite").parquet(f"{ROOT}/{tag}-a")
    parsed.groupBy((F.col("p") % 5).alias("k")).agg(F.sum("p").alias("s")).write.mode("overwrite").parquet(f"{ROOT}/{tag}-b")
    if cache:
        parsed.unpersist()


def measure(label, fn):
    before = calls.value
    t0 = time.time()
    fn()
    print(f"{label:<44} parser calls {calls.value - before:>8,}  = {(calls.value - before) / ROWS:.2f} x rows   {time.time() - t0:5.1f} s")


df = spark.read.parquet(src)
measure("batch: one write", lambda: df.withColumn("p", parse_udf("payload")).select("id", "p").write.mode("overwrite").parquet(f"{ROOT}/one"))
measure("batch: two writes, no cache", lambda: two_writes(df, "nocache", False))
measure("batch: two writes, persist() first", lambda: two_writes(df, "cache", True))

# the same inside foreachBatch, as in a streaming job that writes several outputs per micro-batch
schema = df.schema


def stream(cache):
    tag = "fb-cache" if cache else "fb-nocache"

    def each(batch_df, batch_id):
        two_writes(batch_df, f"{tag}-{batch_id}", cache)

    q = (spark.readStream.schema(schema).parquet(src).writeStream.foreachBatch(each)
         .option("checkpointLocation", f"{ROOT}/{tag}-ckpt").trigger(availableNow=True).start())
    q.awaitTermination()


measure("foreachBatch: two writes, no cache", lambda: stream(False))
measure("foreachBatch: two writes, persist() first", lambda: stream(True))
spark.stop()
