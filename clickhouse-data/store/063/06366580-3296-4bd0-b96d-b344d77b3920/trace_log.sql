ATTACH TABLE _ UUID 'e50563bc-684c-4d26-b5c1-6af7f49e16dc'
(
    `event_date` Date,
    `event_time` DateTime,
    `event_time_microseconds` DateTime64(6),
    `timestamp_ns` UInt64,
    `revision` UInt32,
    `trace_type` Enum8('Real' = 0, 'CPU' = 1, 'Memory' = 2, 'MemorySample' = 3, 'MemoryPeak' = 4),
    `thread_id` UInt64,
    `query_id` String,
    `trace` Array(UInt64),
    `size` Int64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, event_time)
SETTINGS index_granularity = 8192
