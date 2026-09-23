---
title: "Turning Three Smart Plugs Into a Multi-Site Electricity Cost Dashboard"
description: "I connected three energy-monitoring plugs across two sites to one time-series database, then turned frequent power readings and public regional tariffs into selected-period electricity-cost estimates. The difficult parts were a changed device protocol, safe collection across a network boundary, and calculating spend without pretending missing samples consumed power."
date: 2026-09-23 22:00:00 +0100
categories: [Homelab, DevOps]
tags: [python, sql, automation, iot, monitoring, grafana, energy]
---

I had three energy-monitoring smart plugs and three isolated sets of numbers,
spread across two sites. Each plug's mobile app could show me what was happening
now, but it could not answer the question I actually cared about:

> How much did each machine cost to run over the period I am looking at?

That sounds like a multiplication. Read the energy total, multiply by the unit
rate, draw a graph. It turned into a small data pipeline because the plugs were
on two networks, one had moved to a protocol no available client could speak,
each site prices electricity differently, and the actual tariffs were not
known.

The finished system collects all three plugs frequently, keeps the readings
in a time-series database, fetches VAT-inclusive regional benchmark rates from a
public API, and calculates estimated spend for whatever period is selected in
the dashboard. It also refuses to invent consumption across a collection gap.

## The Shape of the System

The final path has five parts:

| Component | Job |
|---|---|
| Two local plug readers | Poll the two plugs on the data host's LAN |
| One remote reader | Poll the plug beside the remote reader |
| Central collector | Write all readings to one database |
| Rate collector | Store regional unit-rate intervals periodically |
| Dashboard | Graph power, energy, rates and estimated spend |

The network boundary was the important part. I did not want to expose the
database, add a general remote shell to the collection path, or scatter another
long-lived credential copy.

The reusable pattern is a read-only agent beside the device. An aggregator
receives readings from it and writes to the database. Credentials stay on one
side of the boundary, and the transport key is restricted to one forced
command and one source:

```text
restrict,from="<aggregator-address>",command="/opt/<reader>/<script>" ssh-ed25519 <public-key>
```

The remote process accepts one JSON request on standard input and returns one
JSON reading on standard output. The key cannot open a shell, allocate a
terminal, forward a port or run a different command. Test both the allowed read
and a forbidden command before trusting that boundary. A forced command tested
only on its happy path is still just a claim.

## The Protocol Changed Underneath the Plug

My first assumption was that an existing Python library would connect to the
plugs, because these models have been locally controllable for years. Discovery
found the device immediately, but authentication failed before the first read.
The device had moved to a vendor protocol that the available clients did not
implement. A compatibility setting in the vendor app exposed a supported,
authenticated local API, after which the read-only calls returned device and
energy data successfully.

Local-protocol modes on consumer devices widen LAN reachability, so treat the
device as untrusted, isolate it appropriately, and keep the integration
read-only.

The lesson was not "enable compatibility mode". It was to identify the protocol
before writing the pipeline. The original design assumed a cloud API and a
particular client library, neither of which could return a reading from the
firmware actually deployed.

## What I Store

Every successful poll inserts one immutable observation per plug:

```sql
CREATE TABLE smart_plug_metrics (
    collected_at       timestamptz NOT NULL DEFAULT now(),
    device_id          text        NOT NULL,
    assignment_id      bigint      NOT NULL,
    device_on          boolean     NOT NULL,
    power_w            double precision,
    today_energy_wh    bigint,
    month_energy_wh    bigint,
    runtime_minutes    integer,
    rssi_dbm            integer,
    PRIMARY KEY (device_id, collected_at)
);
```

The stable device ID and timestamp form the key. The friendly name is not an
identity, because someone can rename a plug in the app at any time. Location
and connected equipment are not raw measurements either: a physical plug can
move, and its load can change.

I keep those facts in separate, effective-dated assignments:

```sql
CREATE TABLE power_device_assignments (
    assignment_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id      text        NOT NULL,
    site_id        bigint      NOT NULL,
    load_id        bigint,
    valid_from     timestamptz NOT NULL,
    valid_to       timestamptz,
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
```

Every sample pins the assignment that was active when it was collected. A move
or equipment swap closes one assignment and opens another; it never updates
the old row. An exclusion constraint prevents overlapping assignments for the
same device. Collection addresses and reader hosts live in a separate current
route table, because changing how a plug is reached should not rewrite what old
measurements meant.

The device reports current power in milliwatts, so the collector normalises it
before insertion:

```python
power_w = current_power_mw / 1000 if current_power_mw is not None else None
```

I kept the device's daily and monthly energy counters too, but they are not the
source for arbitrary-period cost. A counter that resets at midnight cannot tell
me the energy used between 14:10 yesterday and 09:35 today without special-case
logic around every reset. The frequent power series can.

## A Rate Is an Interval, Not a Setting

I did not know the exact tariff at the remote property, and I only knew the
supplier rather than the tariff at home. Guessing a fixed pence-per-kWh value in
an environment file would have produced a precise-looking number with no useful
provenance.

I used a public tariff API as a regional benchmark instead. It publishes
VAT-inclusive standard unit rates for each electricity distribution region,
including the time at which each rate starts and ends. No account credential is
needed for that public endpoint.

The dashboard therefore says **estimated** everywhere. The rate is a regional
Direct Debit proxy, not a claim about either property's bill. Standing charges
are excluded because they apply to the meter and household, not to one plug.

The rate table stores the complete interval history returned by the API:

```sql
CREATE TABLE electricity_unit_rates (
    site                       text          NOT NULL,
    region_code                text          NOT NULL,
    product_code               text          NOT NULL,
    payment_method             text          NOT NULL,
    valid_from                 timestamptz   NOT NULL,
    valid_to                   timestamptz,
    pence_per_kwh_inc_vat      numeric(10,6) NOT NULL,
    source_name                text          NOT NULL,
    source_url                 text          NOT NULL,
    retrieved_at               timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (site, product_code, payment_method, valid_from)
);
```

Storing validity intervals matters even for a tariff that changes only every
few months. If I overwrite one `CURRENT_RATE` value, a graph of last quarter's
spend silently gets recalculated using this quarter's price. Historical cost
should be reproducible from historical inputs.

The rate collector runs periodically. That is deliberately unexciting. The
rate does not need high-frequency polling, but checking more than once per day
means a newly published interval lands quickly and a temporary API failure gets
another chance before the next billing period.

## Turning Watts Into Pounds

Power is a rate. Energy is power accumulated over time. With one reading per
minute, I use the trapezoidal rule between adjacent samples:

```text
average power (W) = (previous W + current W) / 2
energy (kWh)      = average power × elapsed seconds / 3,600,000
cost (£)          = energy × pence per kWh / 100
```

In SQL, the first stage pairs every sample with the one before it:

```sql
WITH ordered_samples AS (
    SELECT
        collected_at AS interval_end,
        lag(collected_at) OVER device_window AS interval_start,
        device_id,
        device_name,
        site,
        power_w,
        lag(power_w) OVER device_window AS previous_power_w
    FROM smart_plug_metrics
    WINDOW device_window AS (
        PARTITION BY assignment_id ORDER BY collected_at
    )
)
SELECT
    ((power_w + previous_power_w) / 2.0)
        * extract(epoch FROM interval_end - interval_start)
        / 3600000.0 AS energy_kwh
FROM ordered_samples;
```

The next stage joins the tariff interval valid at `interval_start` and converts
pence to pounds.

Partitioning by assignment is another guard: no energy interval can cross a
site move or load swap. There is also one time guard that matters more than the
formula:

```sql
AND interval_end - interval_start <= interval '2 minutes'
```

Suppose the collector goes offline for six hours while a machine happens to be
drawing 200 W immediately before and after the gap. Connecting those two points
would manufacture 1.2 kWh of consumption that was never measured. It may be a
reasonable estimate, but this dashboard is already using an estimated tariff.
I did not want a second invisible estimate inside the energy input, so gaps over
two minutes contribute nothing.

That makes the result conservative during outages and, more importantly,
honest about what the system observed.

Measuring the guard afterwards is what showed how the threshold should have been
chosen. All three plugs poll at a 60-second median with a 63-second 95th
percentile, but the remote plug's tail reaches 119.9 seconds, close enough to a
two-minute threshold to matter, and an interval landing exactly on the boundary
is included by a `<=` comparison rather than excluded. Interpolated energy came
to 0.48% of the total, and that error is one-directional: it can only overstate,
never understate.

The lesson is in how you pick the number rather than in the number itself. Derive
the threshold as a multiple of measured cadence instead of a round human figure,
decide `<` or `<=` deliberately rather than by default, and expose the
interpolated share as a queryable column so it is auditable instead of invisible
inside a total. A guard you cannot measure is a guess with a comparison operator.

## The Dashboard Follows the Time Picker

The dashboard started with five panels:

- power draw over time;
- the device's daily energy counter;
- Wi-Fi signal;
- relay state;
- age of the latest sample.

I then added four cost sections:

- **estimated spend in the selected period**, one value per plug;
- **cumulative estimated spend**, one line per plug;
- **estimated unit rate**, one line per site;
- **methodology notice**, always visible below the graphs.

The spend stat is driven by the dashboard time range rather than a hardcoded
day or month:

```sql
SELECT
    max(interval_end) AS time,
    sum(estimated_cost_gbp) AS value,
    device_name AS metric
FROM smart_plug_cost_intervals
WHERE $__timeFilter(interval_end)
GROUP BY device_name
ORDER BY device_name;
```

Selecting the last hour, last seven days or a custom range changes the answer
without changing the query. It only calculates periods covered by collected
samples, so a range that predates collection shows only the available portion.
The notice says that plainly.

The unit-rate graph is useful even on a standard variable benchmark. It makes a
quarterly price change visible and proves which input the spend graph used. A
cost chart without its price input beside it is much harder to audit six months
later.

## How I Tested the Number

I used three levels of validation.

**Unit tests** cover API filtering and normalisation. The response contains
multiple payment methods and values with and without tax. The collector must
retain only the configured tax-inclusive benchmark interval. Tests also check
regional endpoint construction and the no-results failure.

**An independent calculation** checks one real database interval. A short
Python script reads the previous power, current power, elapsed seconds and rate,
then calculates energy and cost separately from the SQL view. Both matched to
less than one trillionth of a pound in the validation run. That precision is not
economically meaningful; it proves both paths implemented the same units and
formula.

**Browser validation** checks the delivered result rather than stopping at the
database. I opened a one-hour range and confirmed:

- all three plug names appeared;
- both regional rates appeared;
- all four cost sections rendered;
- no panel said `No data`;
- no query or browser-console error appeared;
- the rate and plug collectors both remained healthy afterwards.

That last layer caught a real bug. My first "last sample" panel queried a
timestamp into a stat visualisation and displayed `No data`, even though the SQL
query returned rows. Converting the timestamp to epoch milliseconds fixed it.
The database being right did not make the dashboard right.

## What the Estimate Does and Does Not Mean

The result answers:

> What would this measured plug consumption have cost at the public
> VAT-inclusive regional benchmark rate during the selected period?

It does not answer:

- the exact amount charged by the property's supplier;
- any standing-charge allocation;
- consumption during missing sample gaps;
- whole-property electricity use;
- history from before the collector started.

Those limits are not footnotes. They are printed on the dashboard. A currency
symbol makes a number feel authoritative very quickly, so the assumptions need
to be closer to the graph than the reader's confidence is.

When I find the real tariffs, I can add them as another source without changing
the energy pipeline. The validity-interval model already supports a fixed rate,
a quarterly variable rate or half-hour pricing. The calculation only needs a
rate covering each sample interval.

## The Useful Pattern

This started as "put the smart-plug data in my dashboard" and ended with a
pattern I can reuse for other small devices:

1. Poll locally where the device protocol expects locality.
2. Cross a site boundary with one forced read command, not a general shell or
   an exposed database.
3. Store raw measurements and external price inputs separately.
4. Keep physical device, site, connected load and collection route as separate
   identities.
5. Pin an effective-dated assignment on every sample so moves never relabel
   history.
6. Give every price a validity interval and source.
7. Calculate derived values in a view so the formula has one implementation.
8. Refuse to bridge assignment changes or long gaps with made-up consumption.
9. Put the estimate warning on the dashboard, not in a document nobody opens.
10. Test the number independently, then test the page a person will actually
   look at.
11. Alert on partial collection failure, not just total failure. A collector
   pulling from several sources can report success while one source has gone
   quiet, and that is the failure mode that hides.

Points 5 and 11 are the two I would get wrong again without thinking about them
first. An effective-dated model that refuses to backdate protects
already-recorded samples, but that same refusal means a move has to be recorded
when it happens rather than when you next remember it. And a collector with
several sources needs its health measured per source, because aggregate success
is not success. Both are properties worth deciding deliberately at design time,
which is cheaper than inferring them later. The arithmetic survived independent
recomputation to twelve decimal places; the operational edges are where the
thinking was actually needed.

Three plugs now produce one selected-period cost view across two sites.
The figure is still an estimate, but it is an estimate with named inputs,
reproducible history and visible limits. That is far more useful than a precise
number whose assumptions disappeared into an environment file.